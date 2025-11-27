const DEVICES = {
    "EE2E04861232": {
        name: "temp1"
    },
    "B0E9FEFAA657": {
        name: "temp2"
    },
    "EEB300866549": {
        name: "temp3"
    },
    "D12D02061D1E": {
        name: "temp4"
    },
    "D12D02065926": {
        name: "temp5"
    },
};

let SHELLY_ID = undefined;
const SCRIPT_VERSION = '1.2';


// Global state for storing latest readings
let deviceReadings = {};

function convertToHex(arr) {
    let hex = '';
    for (let i = 0; i < arr.length; i++) {
        h = arr[i].toString(16);
        hex += ('00' + h).slice(-2);
    }
    return hex;
}

function cleanMacAddress(addr) {
    let cleaned = "";
    for (let i = 0; i < addr.length; i++) {
        if (addr[i] !== ':') {
            cleaned += addr[i];
        }
    }
    return cleaned.toUpperCase();
}

function parseSwitchBotData(data, isHub) {
    try {
        if (isHub) {
            let temp = data.charCodeAt(8) & 0x7F;  // Extract temperature from byte 9 (index 8)
            let temp_decimal = (data.charCodeAt(7) & 0x0F);
            temp += temp_decimal * 0.1;
            let humidity = data.charCodeAt(9) & 0x7F;
            return { temperature: temp, humidity: humidity, raw: data };
        } else {
            let temp = data.charCodeAt(3) & 0x7F;  // Extract temperature from the lowest 6 bits of 4th byte
            let temp_decimal = (data.charCodeAt(2) & 0x0F);
            temp += temp_decimal * 0.1;
            let humidity = data.charCodeAt(4) & 0x7F;  // Humidity in byte 5
            return { temperature: temp, humidity: humidity, raw: data };
        }
    } catch (e) {
        print("Parse error:", e);
        return null;
    }
}

function handleScanResult(event, result) {
      if (event === BLE.Scanner.SCAN_RESULT && result && 
        result.manufacturer_data && result.manufacturer_data["0969"]) {
          
        let addr = cleanMacAddress(result.addr);
        let device = DEVICES[addr];
        
        if (device) {
          
            let mfgData = result.manufacturer_data["0969"].substring(6, result.manufacturer_data["0969"].length);
            let isHub = addr === "DD4698BD8C71";
            let data = parseSwitchBotData(mfgData, isHub);
            
			let bthome = [];
			bthome[0] = 0x40;		
			bthome[1] = 0x02;
			bthome[2] = (data.temperature * 100) & 0xFF;
			bthome[3] = (data.temperature * 100) >> 8;
			bthome[4] = 0x03;
			bthome[5] = (data.humidity * 100) & 0xFF;
			bthome[6] = (data.humidity * 100) >> 8;
           
            if (data) {
                    deviceReadings[addr] = {
                    name: device.name,
					addr: result.addr,
                    temperature: data.temperature,
                    humidity: data.humidity,
					rssi: result.rssi,
					bthome: bthome,
                    timestamp: Date.now()
                    };
  
            }
        }
    }
}

function sendMQTT() {
    let now = Date.now();
    for (let addr in deviceReadings) {
        let reading = deviceReadings[addr];

        // Only update readings less than 5 minutes old
        if (now - reading.timestamp < 300000) {
			// create MQTT-Payload
			let message = {
				scriptVersion: SCRIPT_VERSION,
				src: SHELLY_ID,
				srcBle: {
					type: reading.name,
					mac: reading.addr,
					rssi: reading.rssi
				},
				payload: convertToHex(reading.bthome)
			};
				  
			console.log('Send ' + JSON.stringify(message));

			if (MQTT.isConnected()) {
				MQTT.publish(SHELLY_ID + '/events/ble', JSON.stringify(message));
			}

        }
    }
}


// Initializes the script and performs the necessary checks and configurations
function init() {
    // get the config of ble component
    let bleConfig = Shelly.getComponentConfig('ble');

    // exit if the BLE isn't enabled
    if (!bleConfig.enable) {
        console.log('Error: The Bluetooth is not enabled, please enable it in the settings');
        return;
    }

    // check if the scanner is already running
    if (BLE.Scanner.isRunning()) {
        console.log('Info: The BLE gateway is running, the BLE scan configuration is managed by the device');
    } else {
        // start the scanner
        let bleScanner = BLE.Scanner.Start({
            duration_ms: BLE.Scanner.INFINITE_SCAN,
            active: true
        });

        if (!bleScanner) {
            console.log('Error: Can not start new scanner');
        }
    }

    BLE.Scanner.Subscribe(handleScanResult);
	
	// Update virtual components every 4 seconds
	Timer.set(4000, true, sendMQTT, null);
}

Shelly.call('Mqtt.GetConfig', '', function (res, err_code, err_msg, ud) {
    SHELLY_ID = res['topic_prefix'];

    init();

});

