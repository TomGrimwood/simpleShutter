let internalTimeScalingFactor = 1.0;

   function _calculateAndSetScalingFactor() {
       const actualDist = parseFloat(DOM.totalSensorDistanceConfigInput.value);
       const calibDist = parseFloat(DOM.calibrationTargetDistanceConfigInput.value);

       // Ensure input elements exist before accessing their values
       if (!DOM.totalSensorDistanceConfigInput || !DOM.calibrationTargetDistanceConfigInput) {
           console.error("Config inputs not found.");
           internalTimeScalingFactor = 1.0;
           if (DOM.timeScalingFactorDisplay) {
               DOM.timeScalingFactorDisplay.textContent = "Error (inputs missing)";
               DOM.timeScalingFactorDisplay.classList.add("error-message");
           }
           return internalTimeScalingFactor;
       }


       if (!isNaN(actualDist) && actualDist > 0 && !isNaN(calibDist) && calibDist >= 0) {
           internalTimeScalingFactor = calibDist / actualDist;
           if (DOM.timeScalingFactorDisplay) {
                DOM.timeScalingFactorDisplay.textContent = internalTimeScalingFactor.toFixed(4);
                DOM.timeScalingFactorDisplay.classList.remove("error-message");
           }
       } else {
           internalTimeScalingFactor = 1.0;
           if (DOM.timeScalingFactorDisplay) {
               DOM.timeScalingFactorDisplay.textContent = "Error (invalid input)";
               DOM.timeScalingFactorDisplay.classList.add("error-message");
           }
       }
       return internalTimeScalingFactor;
   }

   function updateScalingFactorAndRedisplay() {
       _calculateAndSetScalingFactor();
       // Call a global function or trigger a custom event if needed
       // For now, assuming triggerDisplayUpdate is in the global scope as in the original code
       if (typeof window.triggerDisplayUpdate === 'function') window.triggerDisplayUpdate();
       else console.error("triggerDisplayUpdate function not found (config-panel.js).");
   }

   function getCurrentTimeScalingFactor() { return internalTimeScalingFactor; }

   // NEW: WiFi config functions
   async function saveWifiSettings() {
       // Check for elements that are still present
       if (!DOM.wifiSsidInput || !DOM.wifiPasswordInput) {
           console.error("WiFi config elements (SSID/Password) not found.");
           return;
       }
       const ssid = DOM.wifiSsidInput.value.trim();
       const password = DOM.wifiPasswordInput.value;
       
       // Force AP mode if SSID is empty, otherwise attempt STA
       const forceAp = (ssid === '');

       // Ensure necessary API functions are available
       if (typeof setWifiCredentials !== 'function' || typeof rebootEsp !== 'function' || typeof window.showConfirmationModal !== 'function') {
           console.error("setWifiCredentials, rebootEsp, or showConfirmationModal API function not available.");
           if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("Error: Required API/UI functions not loaded.");
           return;
       }

       let confirmMessage;
       if (ssid === '') {
           confirmMessage = "Leaving SSID empty will clear existing WiFi credentials and revert the device to Hotspot (AP) mode on reboot. Confirm save and reboot?";
       } else {
           confirmMessage = `Save WiFi credentials for "${ssid}" and reboot device? Device will try to connect to this network on reboot.`;
       }

       showConfirmationModal(confirmMessage, async (confirmed) => {
           if (confirmed) {
               if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("Saving WiFi settings and initiating reboot...");
               const setResult = await setWifiCredentials(ssid, password, forceAp);
               if (setResult.success) {
                   if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("WiFi settings saved. Device is rebooting...");
                   // Immediately trigger a reboot after saving
                   const rebootResult = await rebootEsp();
                   if (rebootResult.success) {
                       alert("Device is rebooting to apply changes. Please connect on the new WiFi Network to esp.local.");
                   } else {
                       if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus(`Failed to reboot: ${rebootResult.message}`);
                   }
               } else {
                   if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus(`Failed to save WiFi: ${setResult.message}`);
               }
           }
       });
   }

   async function forgetAndRestartWifi() {
       if (typeof forgetWifi !== 'function') {
           console.error("forgetWifi API function not available.");
           if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("Error: WiFi API not loaded.");
           return;
       }
       if (typeof window.showConfirmationModal !== 'function') {
           console.error("showConfirmationModal not available.");
           return;
       }

       showConfirmationModal("Are you sure you want to forget all saved WiFi networks and reboot? This will put the device into Hotspot (AP) mode.", async (confirmed) => {
           if (confirmed) {
               if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("Forgetting WiFi networks and rebooting...");
               const result = await forgetWifi();
               if (result.success) {
                   // Device will reboot, so UI might become unresponsive
                   if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("WiFi networks forgotten. Device rebooting.");
                   alert("Device is rebooting to apply changes. Please reconnect to 'ESP32_Shutter_AP' after a minute.");
               } else {
                   if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus(`Failed to forget WiFi: ${result.message}`);
               }
           }
       });
   }

   // REMOVED revertToSta function (button removed from UI)
   // async function revertToSta() {
   //     if (typeof revertToStaMode !== 'function') {
   //         console.error("revertToStaMode API function not available.");
   //         if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("Error: WiFi API not loaded.");
   //         return;
   //     }
   //     if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("Attempting to revert to STA mode...");
   //     const result = await revertToStaMode();
   //     if (result.success) {
   //         if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("Device is attempting to connect to STA mode.");
   //     } else {
   //         if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus(`Failed to revert to STA: ${result.message}`);
   //     }
   // }

   // NEW: Function to trigger a device reboot
   async function triggerDeviceReboot() {
       if (typeof window.showConfirmationModal !== 'function') {
           console.error("showConfirmationModal not available.");
           return;
       }

       showConfirmationModal("Are you sure you want to reboot the device? The connection will be lost.", async (confirmed) => {
           if (confirmed) {
               if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("Sending reboot command...");
               if (typeof rebootEsp !== 'function') {
                   console.error("rebootEsp API function not available.");
                   if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("Error: Reboot API not loaded.");
                   return;
               }
               const result = await rebootEsp();
               if (result.success) {
                   if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus("Device rebooting. Please reconnect after a minute.");
                    alert("Device is rebooting to apply changes. Please connect on the new WiFi Network to esp.local.");
               } else {
                   if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus(`Failed to reboot: ${result.message}`);
               }
           }
       });
   }


   function initializeConfigPanelInteraction() {
       // Ensure DOM elements exist before adding listeners
       if (!DOM.totalSensorDistanceConfigInput || !DOM.calibrationTargetDistanceConfigInput || !DOM.toggleConfigButton || !DOM.configPanel ||
           !DOM.wifiSsidInput || !DOM.wifiPasswordInput || !DOM.saveWifiButton || !DOM.forgetWifiButton || // REMOVED forceApCheckbox and revertToStaButton
           !DOM.rebootDeviceButton) { // Keep rebootDeviceButton
           console.error("Failed to initialize config panel interaction: Missing core DOM elements.");
           return;
       }

       _calculateAndSetScalingFactor();
       DOM.totalSensorDistanceConfigInput.addEventListener('input', updateScalingFactorAndRedisplay);
       DOM.calibrationTargetDistanceConfigInput.addEventListener('input', updateScalingFactorAndRedisplay);

       DOM.toggleConfigButton.addEventListener('click', () => {
           const isCollapsed = DOM.configPanel.classList.toggle('collapsed');
           DOM.toggleConfigButton.innerHTML = isCollapsed ? '»' : '«';
           DOM.toggleConfigButton.title = isCollapsed ? "Expand Panel" : "Collapse Panel";
           try { localStorage.setItem('configPanelCollapsed', String(isCollapsed)); }
           catch (e) { console.warn("localStorage not available for config panel state:", e); }
       });

       // Add WiFi button event listeners
       DOM.saveWifiButton.addEventListener('click', saveWifiSettings);
       DOM.forgetWifiButton.addEventListener('click', forgetAndRestartWifi);
       // REMOVED DOM.revertToStaButton.addEventListener('click', revertToSta);

       // Add Reboot button event listener
       DOM.rebootDeviceButton.addEventListener('click', triggerDeviceReboot);

       // Restore collapsed state from localStorage
       try {
           if (localStorage.getItem('configPanelCollapsed') === 'true') {
               DOM.configPanel.classList.add('collapsed');
               if (DOM.toggleConfigButton) {
                    DOM.toggleConfigButton.innerHTML = '»';
                    DOM.toggleConfigButton.title = "Expand Panel";
               }
           }
       } catch (e) { console.warn("localStorage not available for config panel state.", e); }
   }