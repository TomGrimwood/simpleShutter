// api.js - Handles WebSocket communication and mock data
   // Depends on ui-helpers.js for updateSystemStatus (via window)

   let webSocket;
   const wsCallbacks = { onOpen: null, onMessage: null, onError: null, onClose: null };
   let mockInterval = null;
   let currentMockMode = "ALL"; // Start mock in ALL mode

   function connectWebSocket(callbacks) {
       // Ensure updateSystemStatus is available from ui-helpers.js via the global scope
       if (typeof window.updateSystemStatus !== 'function') {
           console.error("connectWebSocket failed: updateSystemStatus helper not available.");
           // Cannot proceed without basic status updates
           return;
       }

       Object.assign(wsCallbacks, callbacks);
       // Determine WebSocket URL based on the current window's protocol and host
       const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
       // Using esp.local as the default, but if the device is in AP mode, 192.168.4.1 should be used.
       // The UI should fetch current IP and update the WS URL if necessary. For initial connection, esp.local is robust.
    //    const ESP32_HOST = 'esp.local'; // Or '192.168.4.1' if in AP mode
    //    const ESP32_PORT = 80; // Or the port your ESP32 web server is running on
    //    const wsUrl = `ws://${ESP32_HOST}:${ESP32_PORT}/ws`;
       console.log("Attempting WS connection:", wsUrl);
       window.updateSystemStatus("Attempting WS connection...");

       // Check if WebSocket is available or if running locally from a file
       if (typeof WebSocket === 'undefined' || window.location.protocol === 'file:') {
           console.warn("WebSocket not supported or running from file://. Using mock WebSocket.");
           window.updateSystemStatus("Using Mock WebSocket (no backend connection).");
           mockWebSocket();
           if (wsCallbacks.onOpen) wsCallbacks.onOpen({type: 'open_mock'}); // Trigger mock open event
           return;
       }

       try {
           webSocket = new WebSocket(wsUrl);

           webSocket.onopen = (e) => {
               console.log("WS open:", wsUrl);
               if(wsCallbacks.onOpen) wsCallbacks.onOpen(e);
           };

           webSocket.onmessage = (e) => {
               // console.log("WS msg:", e.data); // Uncomment for detailed message logging
               if(wsCallbacks.onMessage) wsCallbacks.onMessage(e.data);
           };

           webSocket.onerror = (e) => {
               console.error("WS error:", e);
               if(wsCallbacks.onError) wsCallbacks.onError(e);
           };

           webSocket.onclose = (e) => {
               console.log("WS closed.", e);
               if(wsCallbacks.onClose) wsCallbacks.onClose(e);
           };

       } catch (e) {
           console.error("WS creation failed:", e);
           window.updateSystemStatus("WS creation failed.");
           // Fallback to mock WebSocket if native WebSocket creation fails
           mockWebSocket();
           if (wsCallbacks.onOpen) wsCallbacks.onOpen({type: 'open_mock_fallback'});
       }
   }

   function mockWebSocket() {
       webSocket = {
           // Simulate readyState: 0 (CONNECTING), 1 (OPEN), 2 (CLOSING), 3 (CLOSED)
           readyState: 1,
           send: (data) => {
               console.log("Mock WS Send:", data);
               try {
                   const cmd = JSON.parse(data);
                   if (cmd.command === "setmode") {
                       currentMockMode = ["ALL", "OUTER", "INNER"][cmd.mode] || "ALL";
                       // Simulate delay before sending mock data for the new mode
                       setTimeout(()=>generateMockData(currentMockMode), 200);
                   } else if (cmd.command === "reset") {
                       // Simulate a reset - maybe clear data and send an initial state
                        window.stagedResults = []; // Assuming stagedResults is global
                        if (typeof renderStagingTable === 'function') renderStagingTable(); // Assuming renderStagingTable is global
                       setTimeout(()=>generateMockData("ALL"), 500); // Reset to ALL after a delay
                   }
               } catch(e){
                   console.error("Mock WS parse error", e);
               }
           },
           close: () => {
               webSocket.readyState = 3;
               clearInterval(mockInterval); // Stop sending mock data
               console.log("Mock WS Close");
               // Simulate close event
               if(wsCallbacks.onClose) wsCallbacks.onClose({code: 1000, reason: "Mock close"});
           },
           // Add a mock URL property for consistency
           url: "mock:precision-shutter-diag"
       };

       // Start sending mock data periodically
       const generateMockData = (mode) => {
           const data = {
               mode: mode.toUpperCase(),
               s1_open_us: null, s1_close_us: null,
               s2_open_us: null, s2_close_us: null,
               s3_open_us: null, s3_close_us: null,
               error: null // Simulate no device errors in mock data
           };

           const baseOpen = Date.now() % 100000; // Simulate a changing start time
           const baseExpTime = 5000; // Base exposure time in microseconds
           const travelTime = 1000; // Base travel time between sensors in microseconds
           const variance = 200; // Variance for adding randomness

           // Add mock data based on mode
           const m = data.mode;
           if (m === "ALL" || m === "OUTER") {
               data.s1_open_us = baseOpen + ~~(Math.random() * variance);
               data.s1_close_us = data.s1_open_us + baseExpTime + ~~(Math.random() * variance - variance/2);
           }
           if (m === "ALL") {
               // S2 opens after S1 open + travel time
               data.s2_open_us = (data.s1_open_us || baseOpen) + travelTime + ~~(Math.random() * variance);
               data.s2_close_us = data.s2_open_us + baseExpTime + ~~(Math.random() * variance - variance/2);
           }
            if (m === "INNER") {
               data.s2_open_us = baseOpen + ~~(Math.random() * variance);
               data.s2_close_us = data.s2_open_us + baseExpTime + ~~(Math.random() * variance - variance/2);
           }
           if (m === "ALL" || m === "OUTER") {
                // S3 opens after S2 open + travel time (if ALL), or S1 open + total travel (if OUTER)
               let prevOpen = (m === "ALL" && data.s2_open_us) ? data.s2_open_us : (data.s1_open_us || baseOpen);
               data.s3_open_us = prevOpen + travelTime + ~~(Math.random() * variance);
               data.s3_close_us = data.s3_open_us + baseExpTime + ~~(Math.random() * variance - variance/2);
           }

           // Ensure close times are after open times, adjust slightly if not
           if (data.s1_open_us > 0 && data.s1_close_us <= data.s1_open_us) data.s1_close_us = data.s1_open_us + baseExpTime;
           if (data.s2_open_us > 0 && data.s2_close_us <= data.s2_open_us) data.s2_close_us = data.s2_open_us + baseExpTime;
           if (data.s3_open_us > 0 && data.s3_close_us <= data.s3_open_us) data.s3_close_us = data.s3_open_us + baseExpTime;


           // Simulate timing errors occasionally
           if (Math.random() < 0.05) { // 5% chance of an error
               const errorType = Math.floor(Math.random() * 3);
               if (errorType === 0 && data.s1_open_us > 0 && data.s2_open_us > 0) { // Simulate S2 open before S1
                    let temp = data.s1_open_us; data.s1_open_us = data.s2_open_us - 50; data.s2_open_us = temp;
                    data.error = "Simulated S2 open before S1 error";
               } else if (errorType === 1 && data.s1_close_us > 0 && data.s2_close_us > 0) { // Simulate S2 close before S1
                    let temp = data.s1_close_us; data.s1_close_us = data.s2_close_us - 50; data.s2_close_us = temp;
                     data.error = "Simulated S2 close before S1 error";
               } else if (errorType === 2) { // Simulate missing data
                    const sensorToRemove = Math.floor(Math.random() * 3) + 1;
                    if (sensorToRemove === 1) { data.s1_open_us = null; data.s1_close_us = null; data.error = "Simulated S1 data missing"; }
                    if (sensorToRemove === 2) { data.s2_open_us = null; data.s2_close_us = null; data.error = "Simulated S2 data missing"; }
                    if (sensorToRemove === 3) { data.s3_open_us = null; data.s3_close_us = null; data.error = "Simulated S3 data missing"; }
               }
                window.updateSystemStatus("Mock device error: " + data.error);
           }


           // Send the generated data
           if (wsCallbacks.onMessage) wsCallbacks.onMessage(JSON.stringify(data));
       };

       // Clear any existing mock interval and set a new one
       clearInterval(mockInterval);
       mockInterval = setInterval(()=>generateMockData(currentMockMode), 5000); // Send data every 5 seconds
   }

   async function setEspMode(modeId) {
       if(webSocket && webSocket.readyState === 1) {
           try {
                webSocket.send(JSON.stringify({command:"setmode", mode:parseInt(modeId)}));
                return {success:true};
           } catch (e) {
               console.error("Error sending setmode command:", e);
               return {success:false, message: e.message || "Failed to send command."};
           }
       }
       // If mock WS, try HTTP POST for compatibility if it's not a WS command
       if (window.location.protocol === 'file:' || webSocket.readyState !== 1) {
           console.warn("WS not open or mock for setEspMode. Attempting HTTP POST.");
           try {
               const response = await fetch('/api/setmode', {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({ mode: parseInt(modeId) })
               });
               if (response.ok) return { success: true };
               const text = await response.text();
               return { success: false, message: `HTTP Error: ${response.status} ${text}` };
           } catch (e) {
               console.error("Error sending setmode via HTTP:", e);
               return { success: false, message: e.message || "Failed to send via HTTP." };
           }
       }
       console.warn("WS not open for setEspMode");
       return {success:false, message:"WebSocket connection not open."};
   }

   async function resetEspSystem() {
       if(webSocket && webSocket.readyState === 1) {
            try {
                webSocket.send(JSON.stringify({command:"reset"}));
                return {success:true};
           } catch (e) {
               console.error("Error sending reset command:", e);
               return {success:false, message: e.message || "Failed to send command."};
           }
       }
        // If mock WS, try HTTP POST for compatibility
       if (window.location.protocol === 'file:' || webSocket.readyState !== 1) {
           console.warn("WS not open or mock for resetEspSystem. Attempting HTTP POST.");
           try {
               const response = await fetch('/api/reset', { method: 'POST' });
               if (response.ok) return { success: true };
               const text = await response.text();
               return { success: false, message: `HTTP Error: ${response.status} ${text}` };
           } catch (e) {
               console.error("Error sending reset via HTTP:", e);
               return { success: false, message: e.message || "Failed to send via HTTP." };
           }
       }
       console.warn("WS not open for resetEspSystem");
       return {success:false, message:"WebSocket connection not open."};
   }

   // NEW: WiFi Configuration API calls
   async function getWifiStatus() {
       try {
           const response = await fetch('/api/wifi/status');
           if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
           return { success: true, data: await response.json() };
       } catch (error) {
           console.error("Error fetching WiFi status:", error);
           return { success: false, message: error.message };
       }
   }

   async function setWifiCredentials(ssid, password, forceAp) {
       try {
           const response = await fetch('/api/wifi/set', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ ssid, password, forceAp })
           });
           if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
           return { success: true, message: await response.text() };
       } catch (error) {
           console.error("Error setting WiFi credentials:", error);
           return { success: false, message: error.message };
       }
   }

   async function forgetWifi() {
       try {
           const response = await fetch('/api/wifi/forget', { method: 'POST' });
           if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
           return { success: true, message: await response.text() };
       } catch (error) {
           console.error("Error forgetting WiFi credentials:", error);
           return { success: false, message: error.message };
       }
   }

   async function revertToStaMode() {
       try {
           const response = await fetch('/api/wifi/revert_to_sta', { method: 'POST' });
           if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
           return { success: true, message: await response.text() };
       } catch (error) {
           console.error("Error reverting to STA mode:", error);
           return { success: false, message: error.message };
       }
   }

   // NEW: Device Reboot API call
   async function rebootEsp() {
       try {
           const response = await fetch('/api/reboot', { method: 'POST' });
           if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
           return { success: true, message: await response.text() };
       } catch (error) {
           console.error("Error rebooting ESP:", error);
           return { success: false, message: error.message };
       }
   }


   // This function doesn't do much in the original code, but serves as an initialization point
   function initializeApiHandlers() {
       console.log("API functions (connectWebSocket, setEspMode, resetEspSystem, getWifiStatus, setWifiCredentials, forgetWifi, revertToStaMode, rebootEsp) are available.");
   }