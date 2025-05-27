document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");
    updateCurrentModeDisplay("LOADING"); // Initial mode display
    fetchData(); // Initial data fetch
    setInterval(fetchData, 5000); // Auto-refresh data every 5 seconds
});

function updateSystemStatus(message) {
    const statusEl = document.getElementById('systemStatus');
    if (statusEl) statusEl.textContent = message;
}

function updateCurrentModeDisplay(modeFromServer) {
    const modeDisplayEl = document.getElementById('currentModeDisplay');
    if (modeDisplayEl) modeDisplayEl.textContent = modeFromServer;
}

async function fetchData() {
    updateSystemStatus("Fetching data...");
    try {
        const response = await fetch('/api/getdata');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        updateSystemStatus("Data received. Processing...");
        console.log("Received data:", data);
        
        updateCurrentModeDisplay(data.mode || "UNKNOWN");

        // Update raw times
        document.getElementById('s1OpenTime').textContent = data.s1_open_us !== undefined ? data.s1_open_us : "---";
        document.getElementById('s1CloseTime').textContent = data.s1_close_us !== undefined ? data.s1_close_us : "---";
        document.getElementById('s2OpenTime').textContent = data.s2_open_us !== undefined ? data.s2_open_us : "---";
        document.getElementById('s2CloseTime').textContent = data.s2_close_us !== undefined ? data.s2_close_us : "---";
        document.getElementById('s3OpenTime').textContent = data.s3_open_us !== undefined ? data.s3_open_us : "---";
        document.getElementById('s3CloseTime').textContent = data.s3_close_us !== undefined ? data.s3_close_us : "---";

        calculateAndDisplayDerivedData(data);
        updateSystemStatus("Display updated. Idle.");

    } catch (error) {
        console.error("Error fetching data:", error);
        updateSystemStatus(`Error: ${error.message}`);
    }
}

function calculateAndDisplayDerivedData(data) {
    const getExposure = (open_us, close_us) => (open_us > 0 && close_us > open_us) ? (close_us - open_us) : 0;
    const formatFraction = (exposure_us) => {
        if (exposure_us <=0) return "---";
        const seconds = exposure_us / 1000000.0;
        return `~1/${Math.round(1.0/seconds)}`;
    };
    
    let s1_exp = getExposure(data.s1_open_us, data.s1_close_us);
    let s2_exp = getExposure(data.s2_open_us, data.s2_close_us);
    let s3_exp = getExposure(data.s3_open_us, data.s3_close_us);

    document.getElementById('s1Exposure').textContent = s1_exp > 0 ? s1_exp : "---";
    document.getElementById('s1ExposureFraction').textContent = formatFraction(s1_exp);
    document.getElementById('s2Exposure').textContent = s2_exp > 0 ? s2_exp : "---";
    document.getElementById('s2ExposureFraction').textContent = formatFraction(s2_exp);
    document.getElementById('s3Exposure').textContent = s3_exp > 0 ? s3_exp : "---";
    document.getElementById('s3ExposureFraction').textContent = formatFraction(s3_exp);

    // Travel Times - Curtain 1 (Opening Edge)
    let c1_s1s2 = (data.s1_open_us > 0 && data.s2_open_us > data.s1_open_us) ? (data.s2_open_us - data.s1_open_us) : 0;
    let c1_s2s3 = (data.s2_open_us > 0 && data.s3_open_us > data.s2_open_us) ? (data.s3_open_us - data.s2_open_us) : 0;
    let c1_s1s3 = (data.s1_open_us > 0 && data.s3_open_us > data.s1_open_us) ? (data.s3_open_us - data.s1_open_us) : 0;
    
    document.getElementById('c1Travel_1_2').textContent = (data.mode === "ALL" && c1_s1s2 > 0) ? c1_s1s2 : "---";
    document.getElementById('c1Travel_2_3').textContent = (data.mode === "ALL" && c1_s2s3 > 0) ? c1_s2s3 : "---";
    document.getElementById('c1Travel_1_3').textContent = ((data.mode === "ALL" || data.mode === "OUTER") && c1_s1s3 > 0) ? c1_s1s3 : "---";

    // Travel Times - Curtain 2 (Closing Edge)
    let c2_s1s2 = (data.s1_close_us > 0 && data.s2_close_us > data.s1_close_us) ? (data.s2_close_us - data.s1_close_us) : 0;
    let c2_s2s3 = (data.s2_close_us > 0 && data.s3_close_us > data.s2_close_us) ? (data.s3_close_us - data.s2_close_us) : 0;
    let c2_s1s3 = (data.s1_close_us > 0 && data.s3_close_us > data.s1_close_us) ? (data.s3_close_us - data.s1_close_us) : 0;

    document.getElementById('c2Travel_1_2').textContent = (data.mode === "ALL" && c2_s1s2 > 0) ? c2_s1s2 : "---";
    document.getElementById('c2Travel_2_3').textContent = (data.mode === "ALL" && c2_s2s3 > 0) ? c2_s2s3 : "---";
    document.getElementById('c2Travel_1_3').textContent = ((data.mode === "ALL" || data.mode === "OUTER") && c2_s1s3 > 0) ? c2_s1s3 : "---";
    
    // Hide/show irrelevant fields based on mode
    const showIf = (elementId, condition) => {
        const el = document.getElementById(elementId);
        const parentCard = el ? el.closest('.result-card') : null; // Find parent card
        const parentP = el ? el.closest('p') : null; // Find parent p if no card

        if (parentCard) { // If element is inside a card, hide/show card
             parentCard.style.display = condition ? '' : 'none';
        } else if (parentP) { // If element is directly in a p (like status bar), hide/show p
            parentP.style.display = condition ? '' : 'none';
        } else if (el) { // Fallback for elements not in card or p (e.g. direct children of grid)
            el.style.display = condition ? '' : 'none';
        }
    };
    
    // Get all card elements by a common class or structure if possible
    // For this example, we target specific cards by one of their unique child IDs
    const s1Card = document.getElementById('s1OpenTime').closest('.result-card');
    const s2Card = document.getElementById('s2OpenTime').closest('.result-card');
    const s3Card = document.getElementById('s3OpenTime').closest('.result-card');
    const c1TravelCard = document.getElementById('c1Travel_1_2').closest('.result-card');
    const c2TravelCard = document.getElementById('c2Travel_1_2').closest('.result-card');


    if (data.mode === "INNER") {
        if(s1Card) s1Card.style.display = 'none';
        if(s2Card) s2Card.style.display = ''; // Show S2
        if(s3Card) s3Card.style.display = 'none';
        if(c1TravelCard) c1TravelCard.style.display = 'none'; // Hide travel times
        if(c2TravelCard) c2TravelCard.style.display = 'none';
    } else if (data.mode === "OUTER") {
        if(s1Card) s1Card.style.display = ''; // Show S1
        if(s2Card) s2Card.style.display = 'none';
        if(s3Card) s3Card.style.display = ''; // Show S3
        if(c1TravelCard) c1TravelCard.style.display = ''; // Show travel, but specific items might be "---"
        if(c2TravelCard) c2TravelCard.style.display = '';
        // Specific items within travel cards might need individual handling if they are not applicable
        document.getElementById('c1Travel_1_2').textContent = "---"; 
        document.getElementById('c1Travel_2_3').textContent = "---";
        document.getElementById('c2Travel_1_2').textContent = "---";
        document.getElementById('c2Travel_2_3').textContent = "---";

    } else { // ALL or UNKNOWN
        if(s1Card) s1Card.style.display = '';
        if(s2Card) s2Card.style.display = '';
        if(s3Card) s3Card.style.display = '';
        if(c1TravelCard) c1TravelCard.style.display = '';
        if(c2TravelCard) c2TravelCard.style.display = '';
    }
}


async function applyModeChange() {
    const modeSelect = document.getElementById('modeSelect');
    const selectedMode = parseInt(modeSelect.value, 10);
    updateSystemStatus(`Setting mode to ${modeSelect.options[modeSelect.selectedIndex].text}...`);

    try {
        const response = await fetch('/api/setmode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: selectedMode })
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();
        console.log("Set mode result:", result);
        if (result.success) {
            updateSystemStatus(`Mode successfully set to ${result.mode_set}. Fetching new data...`);
            updateCurrentModeDisplay(result.mode_set); // Update display immediately
            await fetchData(); // Refresh data after mode change
        } else {
            updateSystemStatus(`Failed to set mode: ${result.message || 'Unknown error'}`);
        }
    } catch (error) {
        console.error("Error setting mode:", error);
        updateSystemStatus(`Error setting mode: ${error.message}`);
    }
}

async function manualReset() {
    updateSystemStatus("Sending reset command...");
    try {
        const response = await fetch('/api/reset', { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();
        console.log("Reset result:", result);
        if (result.success) {
            updateSystemStatus("System reset successfully. Fetching new data...");
            await fetchData(); // Refresh data after reset
        } else {
            updateSystemStatus("Failed to reset system.");
        }
    } catch (error) {
        console.error("Error resetting system:", error);
        updateSystemStatus(`Error resetting: ${error.message}`);
    }
}

function refreshData() {
    console.log("Refresh Data button clicked.");
    fetchData();
}

// Old handleCalculate is now refreshData, if button's onclick was changed.
// Or repurpose/remove if not used. For now, refreshData is the action for that button.
