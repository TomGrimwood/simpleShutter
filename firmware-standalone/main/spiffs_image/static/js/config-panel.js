// config-panel.js

function _calculateAndSetScalingFactor() {
    const actualDist = parseFloat(document.getElementById('totalSensorDistanceConfig').value);
    const calibDist = parseFloat(document.getElementById('calibrationTargetDistanceConfig').value);

    if (!isNaN(actualDist) && !isNaN(calibDist) && calibDist > 0) {
        const factor = calibDist / actualDist;
        document.getElementById('timeScalingFactorDisplay').textContent = factor.toFixed(4);
        return factor;
    }
    document.getElementById('timeScalingFactorDisplay').textContent = "Error";
    return 1.0; // Default to 1.0 if inputs are invalid
}

function updateScalingFactorAndRedisplay() {
    _calculateAndSetScalingFactor();
    // If data exists, re-trigger display with new scaling factor
    // This assumes that updateShutterDisplay (or a similar function)
    // will re-read the scaling factor when it processes data.
    // Call the global triggerDisplayUpdate from main.js
    if (typeof triggerDisplayUpdate === 'function') {
        triggerDisplayUpdate();
    } else {
        console.error("triggerDisplayUpdate function not found. Ensure main.js is loaded and function is global.");
    }
}

function getCurrentTimeScalingFactor() {
    const factorText = document.getElementById('timeScalingFactorDisplay').textContent;
    const factor = parseFloat(factorText);
    if (!isNaN(factor) && factorText !== "Error") {
        return factor;
    }
    return 1.0; // Default or if error
}

function initializeConfigPanelInteraction() {
    // Initial calculation
    _calculateAndSetScalingFactor();

    // Listeners for config inputs
    document.getElementById('totalSensorDistanceConfig').addEventListener('input', updateScalingFactorAndRedisplay);
    document.getElementById('calibrationTargetDistanceConfig').addEventListener('input', updateScalingFactorAndRedisplay);

    // Toggle functionality
    const toggleButton = document.getElementById('toggleConfigButton');
    const configPanelContent = document.getElementById('configPanelContent');
    const configPanel = document.getElementById('configPanel');

    toggleButton.addEventListener('click', () => {
        const isCollapsed = configPanelContent.style.display === 'none';
        configPanelContent.style.display = isCollapsed ? '' : 'none';
        toggleButton.textContent = isCollapsed ? '«' : '»';
        configPanel.classList.toggle('collapsed', !isCollapsed);
        // Store state in localStorage
        localStorage.setItem('configPanelCollapsed', !isCollapsed);
    });

    // Restore state from localStorage
    if (localStorage.getItem('configPanelCollapsed') === 'true') {
        configPanelContent.style.display = 'none';
        toggleButton.textContent = '»';
        configPanel.classList.add('collapsed');
    }
}
