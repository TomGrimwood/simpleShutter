// ui-helpers.js
   const DOM = {
       // Core structure elements checked in main.js
       pageContainer: document.querySelector('.page-container'), // Use querySelector for class
       mainContent: document.querySelector('.main-content'), // Use querySelector for class
       header: document.querySelector('.header'), // Use querySelector for class
       statusTab: document.querySelector('.status-bar'), // Use querySelector for class - assuming status-bar is what was meant by statusTab
       tabNavigation: document.querySelector('.tab-navigation'), // Use querySelector for class
       footer: document.querySelector('.footer'), // Use querySelector for class
       confirmationModal: document.getElementById('confirmationModal'), // This one was already there

       // Configuration Panel elements
       configPanel: document.getElementById('configPanel'),
       toggleConfigButton: document.getElementById('toggleConfigButton'),
       configPanelContent: document.getElementById('configPanelContent'),
       totalSensorDistanceConfigInput: document.getElementById('totalSensorDistanceConfig'),
       calibrationTargetDistanceConfigInput: document.getElementById('calibrationTargetDistanceConfig'),
       timeScalingFactorDisplay: document.getElementById('timeScalingFactorDisplay'),

       // NEW: WiFi Configuration Elements
       wifiSsidInput: document.getElementById('wifiSsidInput'),
       wifiPasswordInput: document.getElementById('wifiPasswordInput'),
       // REMOVED: forceApCheckbox: document.getElementById('forceApCheckbox'),
       saveWifiButton: document.getElementById('saveWifiButton'),
       forgetWifiButton: document.getElementById('forgetWifiButton'),
       // REMOVED: revertToStaButton: document.getElementById('revertToStaButton'),

       // NEW: General Device Actions Elements
       rebootDeviceButton: document.getElementById('rebootDeviceButton'),


       // Status Bar elements
       sensorModeSelector: document.getElementById('sensorModeSelector'),
       esp32ConnectionStatus: document.getElementById('esp32-connection-status'),
       lastUpdate: document.getElementById('last-update'),
       systemStatus: document.getElementById('systemStatus'),


       // Main Analysis Tab elements
       timestampUnitSelector: document.getElementById('timestampUnitSelector'),
       errorDisplay: document.getElementById('error-display'),
       exp_ms_s1: document.getElementById('exp_ms_s1'),
       exp_compare_s1s2: document.getElementById('exp_compare_s1s2'),
       exp_ms_s2: document.getElementById('exp_ms_s2'),
       exp_compare_s2s3: document.getElementById('exp_compare_s2s3'),
       exp_ms_s3: document.getElementById('exp_ms_s3'),
       exp_ms_avg: document.getElementById('exp_ms_avg'),
       hz_s1: document.getElementById('hz_s1'),
       hz_s2: document.getElementById('hz_s2'),
       hz_s3: document.getElementById('hz_s3'),
       hz_avg: document.getElementById('hz_avg'),
       ct_c1_s1s2_time: document.getElementById('ct_c1_s1s2_time'),
       ct_c1_intra_pct_var: document.getElementById('ct_c1_intra_pct_var'),
       ct_c1_s2s3_time: document.getElementById('ct_c1_s2s3_time'),
       ct_c1_total_time: document.getElementById('ct_c1_total_time'),
       ct_c1c2_s1s2_compare_pct: document.getElementById('ct_c1c2_s1s2_compare_pct'),
       ct_c1c2_s2s3_compare_pct: document.getElementById('ct_c1c2_s2s3_compare_pct'),
       ct_c1c2_total_compare_pct: document.getElementById('ct_c1c2_total_compare_pct'),
       ct_c2_s1s2_time: document.getElementById('ct_c2_s1s2_time'),
       ct_c2_intra_pct_var: document.getElementById('ct_c2_intra_pct_var'),
       ct_c2_s2s3_time: document.getElementById('ct_c2_s2s3_time'),
       ct_c2_total_time: document.getElementById('ct_c2_total_time'),
       open_time_duration_ms: document.getElementById('open_time_duration_ms'),
       slit_width_mm: document.getElementById('slit_width_mm'),
       exp_var_pct: document.getElementById('exp_var_pct'),
       raw_s1: document.getElementById('raw_s1'),
       raw_s2: document.getElementById('raw_s2'),
       raw_s3: document.getElementById('raw_s3'),

       // Results Log Tab elements
       bucketNameInputStaging: document.getElementById('bucketNameInputStaging'),
       createBucketButton: document.getElementById('createBucketButton'),
       resultsLogTableBody: document.getElementById('resultsLogTable')?.getElementsByTagName('tbody')[0],
       stagingCount: document.getElementById('stagingCount'),
       clearStagingButton: document.getElementById('clearStagingButton'),
       savedBucketsContainer: document.getElementById('savedBucketsContainer'),
       newBucketDropZone: document.getElementById('newBucketDropZone'), // NEW: Add this element

       // Confirmation Modal elements
       modalMessageText: document.getElementById('modalMessageText'),
       modalConfirmButton: document.getElementById('modalConfirmButton'),
       modalCancelButton: document.getElementById('modalCancelButton'),
       bucketNameInputModal: document.getElementById('bucketNameInputModal'), // Added to DOM object

       // Bucket Deep Dive Tab elements
       bucketDeepDiveTabContent: document.getElementById('bucketDeepDiveTabContent'), // Need this for the check in main.js
       deepDiveBucketName: document.getElementById('deepDiveBucketName'),
       dd_exp_ms_s1: document.getElementById('dd_exp_ms_s1'),
       dd_exp_compare_s1s2: document.getElementById('dd_exp_compare_s1s2'),
       dd_exp_ms_s2: document.getElementById('dd_exp_ms_s2'),
       dd_exp_compare_s2s3: document.getElementById('dd_exp_compare_s2s3'),
       dd_exp_ms_s3: document.getElementById('dd_exp_ms_s3'),
       dd_exp_ms_avg: document.getElementById('dd_exp_ms_avg'),
       dd_hz_s1: document.getElementById('dd_hz_s1'),
       dd_hz_s2: document.getElementById('dd_hz_s2'),
       dd_hz_s3: document.getElementById('dd_hz_s3'),
       dd_hz_avg: document.getElementById('dd_hz_avg'),
       dd_ct_c1_s1s2_time: document.getElementById('dd_ct_c1_s1s2_time'),
       dd_ct_c1_intra_pct_var: document.getElementById('dd_ct_c1_intra_pct_var'),
       dd_ct_c1_s2s3_time: document.getElementById('dd_ct_c1_s2s3_time'),
       dd_ct_c1_total_time: document.getElementById('dd_ct_c1_total_time'),
       dd_ct_c1c2_s1s2_compare_pct: document.getElementById('dd_ct_c1c2_s1s2_compare_pct'),
       dd_ct_c1c2_s2s3_compare_pct: document.getElementById('dd_ct_c1c2_s2s3_compare_pct'),
       dd_ct_c1c2_total_compare_pct: document.getElementById('dd_ct_c1c2_total_compare_pct'),
       dd_ct_c2_s1s2_time: document.getElementById('dd_ct_c2_s1s2_time'),
       dd_ct_c2_intra_pct_var: document.getElementById('dd_ct_c2_intra_pct_var'),
       dd_ct_c2_s2s3_time: document.getElementById('dd_ct_c2_s2s3_time'),
       dd_ct_c2_total_time: document.getElementById('dd_ct_c2_total_time'),
       dd_open_time_duration_ms: document.getElementById('dd_open_time_duration_ms'),
       dd_slit_width_mm: document.getElementById('dd_slit_width_mm'),
       dd_exp_var_pct: document.getElementById('dd_exp_var_pct'),
   };

   function setText(elementId, value, decimalPlaces = undefined, unit = '') {
       const element = DOM[elementId] || document.getElementById(elementId);
       if (element) {
           if (value === null || typeof value === 'undefined' || value === '---' ||
               (typeof value === 'number' && (isNaN(value) || !isFinite(value))) ||
               (typeof value === 'string' && (value.toLowerCase() === 'nan' || value.toLowerCase() === 'n/a' || value.toLowerCase() === 'inf'))) {
               element.textContent = '---';
           } else if (typeof value === 'number' && decimalPlaces !== undefined) {
               element.textContent = value.toFixed(decimalPlaces) + unit;
           } else {
               const valueStr = String(value);
               if (unit && !valueStr.endsWith(unit.trim()) && !valueStr.endsWith(unit.trim().slice(0,-1))) { // Check for plural units too
                    element.textContent = valueStr + unit;
               } else {
                   element.textContent = valueStr;
               }
           }
       }
   }

   function getText(elementId, defaultValue = '---') {
       const element = DOM[elementId] || document.getElementById(elementId);
       if (element && element.textContent && element.textContent.trim() !== '' && element.textContent.trim() !== '---') {
           let text = element.textContent.trim();
           text = text.replace(/\s+(ms|hz|%|mm)$/i, '').trim();
           return text;
       }
       return defaultValue;
   }

   function formatRawTimestamp(timestamp_us, unit) {
       if (timestamp_us === null || typeof timestamp_us === 'undefined' || timestamp_us === 0) return '---';
       const num_us = Number(timestamp_us);
       if (isNaN(num_us)) return '---';
       let value; let displayUnit = '';
       switch (unit) {
           case 'ms': value = (num_us / 1000.0).toFixed(3); displayUnit = ' ms'; break;
           case 's':  value = (num_us / 1000000.0).toFixed(6); displayUnit = ' s'; break;
           case 'us': default: value = Math.round(num_us); displayUnit = ' µs'; break;
       }
       return value + displayUnit;
   }

   function initializeTabs() {
       const tabButtons = document.querySelectorAll('.tab-button');
       const tabContents = document.querySelectorAll('.tab-content');
       tabButtons.forEach(button => {
           button.addEventListener('click', () => {
               tabButtons.forEach(btn => btn.classList.remove('active'));
               tabContents.forEach(content => content.classList.remove('active'));
               button.classList.add('active');
               const tabContentElement = document.getElementById(button.dataset.tabId + "Content");
               if (tabContentElement) tabContentElement.classList.add('active');
               else console.error("Tab content not found for ID: " + button.dataset.tabId + "Content");
           });
       });
   }
   // Exporting activateTab to the global scope or preferred module export method
   window.activateTab = function(tabId) {
       const tabButton = document.querySelector(`.tab-button[data-tab-id="${tabId}"]`);
       if (tabButton) tabButton.click();
   };


   function updateSystemStatus(message) {
       if (DOM.systemStatus) DOM.systemStatus.textContent = message;
       else console.log("System Status (ui-helpers.js):", message, "(DOM.systemStatus not found)");
   }
   // Exporting updateSystemStatus
   window.updateSystemStatus = updateSystemStatus;

   let modalResolve = null; // Renamed to avoid confusion with `modalConfirmResolve` in results-log.js
   /**
    * Shows a modal dialog for confirmation or prompting for input.
    * @param {string} message The message to display.
    * @param {Function|null} callback Callback function, receives `true` or `false` for confirmation, or input string/null for prompt.
    *                                 Set to `null` if you only intend to use the Promise return.
    * @param {object|null} inputConfig Optional. If provided, turns the modal into an input prompt.
    *   {
    *     placeholder: string,
    *     defaultValue: string,
    *     confirmText: string,
    *     cancelText: string
    *   }
    * @returns {Promise<string|boolean|null>} Resolves with the input string (if prompt and confirmed), `true` (if confirmation and confirmed), or `null` (if cancelled).
    */
   function showPromptModal(message, callback = null, inputConfig = null) { // FIX: Make callback optional
       DOM.modalMessageText.textContent = message;
       DOM.bucketNameInputModal.value = ''; // Clear previous input
       DOM.bucketNameInputModal.style.display = 'none'; // Hide by default

       if (inputConfig) {
           DOM.bucketNameInputModal.style.display = 'block';
           DOM.bucketNameInputModal.placeholder = inputConfig.placeholder || '';
           if (inputConfig.defaultValue) DOM.bucketNameInputModal.value = inputConfig.defaultValue;
           DOM.modalConfirmButton.textContent = inputConfig.confirmText || 'OK';
           DOM.modalCancelButton.textContent = inputConfig.cancelText || 'Cancel';
       } else {
           // Reset for simple confirmation
           DOM.modalConfirmButton.textContent = 'Confirm';
           DOM.modalCancelButton.textContent = 'Cancel';
       }
       
       return new Promise((resolve) => {
           modalResolve = (confirmed) => {
               DOM.confirmationModal.style.display = 'none';
               let returnValue;
               if (inputConfig) {
                   returnValue = confirmed ? DOM.bucketNameInputModal.value : null; // Return null if cancelled for prompt
               } else {
                   returnValue = confirmed; // Return boolean for confirmation
               }
               
               // FIX: Only call callback if it's a function
               if (typeof callback === 'function') {
                   callback(returnValue); 
               }

               resolve(returnValue);  // Resolve the promise
               modalResolve = null; // Clear resolver
           };
           DOM.confirmationModal.style.display = 'flex';
           if (inputConfig) DOM.bucketNameInputModal.focus(); // Focus on input if present
       });
   }

   DOM.modalConfirmButton?.addEventListener('click', () => {
       if (modalResolve) modalResolve(true);
   });
   DOM.modalCancelButton?.addEventListener('click', () => {
       if (modalResolve) modalResolve(false);
   });

   // Exporting showPromptModal (renamed from showConfirmationModal)
   window.showConfirmationModal = showPromptModal; // Keep alias for backward compatibility (where only confirmation is used)
   window.showPromptModal = showPromptModal; // New name for input-enabled modal