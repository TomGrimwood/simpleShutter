// main.js - Main application entry point
   // Depends on ui-helpers.js for DOM access, updateSystemStatus, initializeTabs, activateTab
   // Depends on config-panel.js for initializeConfigPanelInteraction
   // Depends on api.js for connectWebSocket, setEspMode, resetEspSystem, initializeApiHandlers, getWifiStatus
   // Depends on data-updater.js for updateShutterDisplay, updateEsp32Status, updateEspModeDisplay
   // Depends on results-log.js for createBucket, clearStagingArea, renderStagingTable, renderSavedBuckets, addDragListenersToStagingRows, addDragListenersToBuckets, addResultToStagingArea // ADDED addResultToStagingArea here

   // Global state (consider refactoring into a state object later)
   window.AppState = {
       lastReceivedData: null, // Stores the last valid data packet from the device
       wifiStatus: { // NEW: Store latest WiFi status
           mode: 'UNKNOWN',
           isConnected: false,
           ssid: 'N/A',
           ipAddress: '0.0.0.0',
           rssi: 0
       }
       // stagedResults and resultBuckets are currently global in results-log.js
   };

   // Wrapper around setEspMode from api.js, includes status updates
   async function applyModeChangeWrapper() {
       // Ensure DOM elements and API functions are available
        if (!DOM.sensorModeSelector || typeof setEspMode !== 'function' || typeof updateSystemStatus !== 'function') {
            console.error("Mode change failed: Missing DOM elements or API function.");
            if (typeof updateSystemStatus === 'function') updateSystemStatus("UI error: Mode selector missing or API unavailable.");
            return;
        }

       const modeSelect = DOM.sensorModeSelector;
       const modeVal = parseInt(modeSelect.value, 10);
       updateSystemStatus(`Setting mode to ${modeSelect.options[modeSelect.selectedIndex].text}...`);
       try {
           const result = await setEspMode(modeVal);
           if (!result.success) {
               updateSystemStatus(`Mode set failed: ${result.message || 'Unknown error'}`);
               console.error("Failed to set ESP mode:", result.message);
           } else {
                updateSystemStatus("Mode change command sent.");
                // The actual mode display update happens when the device sends back data with the new mode
           }
       } catch (error) {
           console.error("Error applying mode change:", error);
           updateSystemStatus(`Mode set error: ${error.message || 'Unknown'}`);
       }
   }

   // Wrapper around resetEspSystem from api.js, includes status updates and clearing staging
   async function manualResetWrapper() {
        // Ensure API function and results-log functions are available
        if (typeof resetEspSystem !== 'function' || typeof clearStagingArea !== 'function' || typeof updateSystemStatus !== 'function') {
            console.error("Reset failed: Missing API or results-log function.");
            if (typeof updateSystemStatus === 'function') updateSystemStatus("UI error: Reset function unavailable.");
            return;
        }

       updateSystemStatus("Sending reset command...");
       try {
           const result = await resetEspSystem();
           if (result.success) {
               // Clear local state assumed to be reset by the device
               if (typeof clearStagingArea === 'function') clearStagingArea();
               AppState.lastReceivedData = null; // Clear last data on reset
               updateSystemStatus("System reset command sent. Awaiting device restart...");
           } else {
                updateSystemStatus(`Reset failed: ${result.message || 'Unknown error'}`);
               console.error("Failed to reset ESP system:", result.message);
           }
       } catch (error) {
           console.error("Error resetting system:", error);
           updateSystemStatus(`Reset error: ${error.message || 'Unknown'}`);
       }
   }
   // Expose manualResetWrapper globally if needed for user interaction (e.g., a button)
   window.manualReset = manualResetWrapper;


   // Function to trigger a display update using the last received data
   // Called when config changes or timestamp unit changes
   function triggerDisplayUpdate() {
        // Ensure updateShutterDisplay is available
        if (typeof updateShutterDisplay !== 'function') {
             console.error("triggerDisplayUpdate failed: updateShutterDisplay function not available.");
             return;
        }

       if (window.AppState.lastReceivedData) {
           updateSystemStatus("Config/Unit change, re-rendering current data...");
           updateShutterDisplay(window.AppState.lastReceivedData, false); // MODIFIED: Pass false for isNewMeasurement
       } else {
           updateSystemStatus("No current data to re-render. Waiting for WebSocket connection and data.");
       }
   }
   // Expose triggerDisplayUpdate globally so config-panel can call it
   window.triggerDisplayUpdate = triggerDisplayUpdate;

   // NEW: Function to update WiFi status in UI
   async function updateWifiStatusInUI() {
       if (typeof getWifiStatus !== 'function' || typeof updateEsp32Status !== 'function') {
           console.error("WiFi status functions not available.");
           return;
       }
       const result = await getWifiStatus();
       if (result.success) {
           const wifiData = result.data;
           window.AppState.wifiStatus = wifiData; // Update global state
           // Update connection status
           const statusText = `Mode: ${wifiData.mode}, Connected: ${wifiData.isConnected ? 'Yes' : 'No'}`;
           updateEsp32Status(wifiData.isConnected, statusText, Date.now()); // Update connection status (green/red dot)

           // Update system status with detailed WiFi info
           let detailedWifiStatus = `WiFi: ${wifiData.ssid} (${wifiData.mode}`;
           if (wifiData.isConnected) {
               detailedWifiStatus += ` - IP: ${wifiData.ipAddress}`;
               if (wifiData.mode === 'STA' && wifiData.rssi !== 0) { // RSSI only relevant for STA client
                   detailedWifiStatus += `, RSSI: ${wifiData.rssi} dBm`;
               }
           } else {
               detailedWifiStatus += ` - Disconnected`;
           }
           detailedWifiStatus += `)`;

           updateSystemStatus(detailedWifiStatus);
           console.log("WiFi Status:", wifiData);
       } else {
           updateEsp32Status(false, "WiFi Status: N/A", Date.now());
           updateSystemStatus(`Failed to get WiFi status: ${result.message}`);
           console.error("Failed to fetch WiFi status:", result.message);
       }
   }


   // Main initialization function called when the DOM is ready
   document.addEventListener('DOMContentLoaded', function() {
       // Ensure core DOM elements are present before proceeding
       if (!DOM.pageContainer || !DOM.configPanel || !DOM.mainContent || !DOM.header || !DOM.statusTab || !DOM.tabNavigation || !DOM.footer || !DOM.confirmationModal) {
           console.error("Core UI elements not found. Application cannot start.");
           // Attempt to show a basic error message if possible
           if (document.body) {
                document.body.innerHTML = '<div style="color: red; text-align: center; margin-top: 50px;">Error: Core UI elements missing. Check HTML structure.</div>';
           }
           return;
       }

       // Initialize UI components
       initializeTabs();
       initializeConfigPanelInteraction();

       // Initialize API handling (sets up WebSocket or mock)
       initializeApiHandlers(); // This is just a log in the provided code, but good practice

       // Add event listeners
       if (DOM.sensorModeSelector) DOM.sensorModeSelector.addEventListener('change', applyModeChangeWrapper);
       if (DOM.createBucketButton) DOM.createBucketButton.addEventListener('click', createBucket);
       if (DOM.clearStagingButton) DOM.clearStagingButton.addEventListener('click', clearStagingArea);
       if (DOM.timestampUnitSelector) DOM.timestampUnitSelector.addEventListener('change', triggerDisplayUpdate);

       // Initial rendering of results log and buckets (will be empty initially)
       renderStagingTable();
       renderSavedBuckets();

       // Add drag/drop listeners to initial elements (more are added as buckets/rows are rendered)
       addDragListenersToStagingRows(); // Might be empty initially, but listeners attach to tbody for future rows
       addDragListenersToBuckets(); // Will be empty initially, listeners added with renderSavedBuckets

       // Update initial status displays
       updateEsp32Status(false, "Initializing...", null);
       updateEspModeDisplay("UNKNOWN");

       // NEW: Fetch and update WiFi status on startup
       updateWifiStatusInUI();
       // Periodically update WiFi status (e.g., every 5 seconds)
       setInterval(updateWifiStatusInUI, 5000);


       // Define WebSocket event handlers
       const wsHandlers = {
           onOpen: () => {
               // Initial update will be done by periodic poll, but this confirms WS is up
               console.log("WebSocket connection established.");
               // updateEsp32Status(true, "Connected (WS)", Date.now()); // Replaced by updateWifiStatusInUI
               // updateSystemStatus("WebSocket connected. Waiting for device data..."); // Replaced by updateWifiStatusInUI
               // Could potentially send a 'getmode' command here if the ESP supports it
           },
           onMessage: (jsonData) => {
               try {
                   const rawData = JSON.parse(jsonData);
                   window.AppState.lastReceivedData = rawData; // Store the last received data

                   // Check for errors in the data packet from the device
                   if (rawData.error) {
                       console.error("Device Error:", rawData.error);
                        if (DOM.errorDisplay) {
                            DOM.errorDisplay.innerHTML = `<p class="error-message">DEVICE ERROR: ${rawData.error}</p>`;
                            DOM.errorDisplay.style.display = 'block'; // Ensure error display is visible
                        }
                       updateSystemStatus("Device reported an error.");
                       // Don't process measurement data if there's a device error flag
                       // However, we still need to update the display itself.
                       if (typeof updateShutterDisplay === 'function') updateShutterDisplay(rawData, false); // MODIFIED: Pass false for isNewMeasurement
                   } else {
                        if (DOM.errorDisplay && !DOM.errorDisplay.innerHTML.includes("CLIENT CALC ERROR")) {
                            DOM.errorDisplay.innerHTML = ''; // Clear device error display if a non-error packet comes
                            DOM.errorDisplay.style.display = 'none'; // Hide if empty
                        }
                       if (typeof updateShutterDisplay === 'function') updateShutterDisplay(rawData, true); // MODIFIED: Pass true for isNewMeasurement
                        else console.error("updateShutterDisplay function not found.");
                   }

                   // Always update connection status and last update time on any message
                   // updateEsp32Status(true, "Connected (WS)", Date.now()); // Replaced by updateWifiStatusInUI
                    if (!rawData.error) updateSystemStatus("Data received."); // Only update status if it wasn't an error packet

                   // Always update mode display if mode is provided in the packet
                   if (typeof updateEspModeDisplay === 'function' && rawData.mode !== undefined) {
                        updateEspModeDisplay(rawData.mode);
                   } else if (rawData.mode === undefined) {
                        console.warn("Received data packet without 'mode' field.");
                   }

               } catch (e) {
                   console.error("WS message processing error:", e, "Received data:", jsonData);
                    if (DOM.errorDisplay) {
                        DOM.errorDisplay.innerHTML = `<p class="error-message">CLIENT JSON PARSE ERROR:<br>${e.message}</p>`;
                        DOM.errorDisplay.style.display = 'block'; // Ensure error display is visible
                    }
                   updateSystemStatus("WS data error.");
               }
           },
           onError: (e) => {
               console.error("WebSocket error:", e);
               updateEsp32Status(false, "WS Error", Date.now()); // Only update WS status, not overall WiFi
               updateSystemStatus("WebSocket error.");
                if (DOM.errorDisplay) {
                    DOM.errorDisplay.innerHTML = `<p class="error-message">WEBSOCKET ERROR: See console for details.</p>`;
                    DOM.errorDisplay.style.display = 'block'; // Ensure error display is visible
                }
           },
           onClose: (e) => {
               console.log("WebSocket closed.", e);
               updateEsp32Status(false, `WS Closed (Code: ${e.code || 'N/A'})`, Date.now()); // Only update WS status
               updateSystemStatus(`WebSocket closed.`);

               // Clear any mock interval if running
                if (window.mockInterval) clearInterval(window.mockInterval);

               // Attempt to reconnect if the connection wasn't intentionally closed
                if (webSocket && typeof webSocket.url === 'string' && !webSocket.url.startsWith('mock:')) {
                   updateSystemStatus("Attempting WebSocket reconnection in 5 seconds...");
                   setTimeout(() => {
                       connectWebSocket(wsHandlers); // Re-call connectWebSocket with the same handlers
                   }, 5000); // Attempt reconnect every 5 seconds
               } else {
                    updateSystemStatus("Mock WebSocket closed. No reconnection attempt.");
               }
           }
       };

       // Establish the WebSocket connection (or mock connection)
       connectWebSocket(wsHandlers);
   });