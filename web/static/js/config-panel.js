// State specific to config panel
let currentTimeScalingFactor = 1.0;

function initializeConfigPanelInteraction() {
    DOM.toggleConfigButton.addEventListener('click', function() {
        DOM.configPanel.classList.toggle('collapsed');
        if (DOM.configPanel.classList.contains('collapsed')) {
            DOM.toggleConfigButton.innerHTML = '»';
            DOM.toggleConfigButton.title = "Expand Configuration Panel";
        } else {
            DOM.toggleConfigButton.innerHTML = '«';
            DOM.toggleConfigButton.title = "Collapse Configuration Panel";
        }
    });

    DOM.totalSensorDistanceConfigInput.addEventListener('input', updateScalingFactorAndRedisplay);
    DOM.calibrationTargetDistanceConfigInput.addEventListener('input', updateScalingFactorAndRedisplay);
    
    // Initialize scaling factor display on load
    _calculateAndSetScalingFactor();
}

function _calculateAndSetScalingFactor() {
    const totalDist = parseFloat(DOM.totalSensorDistanceConfigInput.value);
    const targetDist = parseFloat(DOM.calibrationTargetDistanceConfigInput.value);

    if (isNaN(totalDist) || totalDist <= 0 || isNaN(targetDist) || targetDist < 0) {
        currentTimeScalingFactor = 1.0; // Default to 1.0 if inputs are invalid
        DOM.timeScalingFactorDisplay.textContent = "N/A (invalid)";
        DOM.timeScalingFactorDisplay.classList.add("error-message");
    } else {
        currentTimeScalingFactor = targetDist / totalDist;
        DOM.timeScalingFactorDisplay.textContent = currentTimeScalingFactor.toFixed(4);
        DOM.timeScalingFactorDisplay.classList.remove("error-message");
    }
}

function updateScalingFactorAndRedisplay() {
    _calculateAndSetScalingFactor();
    // If AppState.lastReceivedData is available, trigger a display update.
    // This relies on AppState being defined in main.js
    if (window.AppState && window.AppState.lastReceivedData && window.AppState.lastReceivedData.shutter_metrics) {
         // This function is defined in data-updater.js
        updateShutterDisplay(window.AppState.lastReceivedData.shutter_metrics);
    }
}

// Expose currentTimeScalingFactor for other modules if needed (e.g., data-updater.js)
function getCurrentTimeScalingFactor() {
    return currentTimeScalingFactor;
}