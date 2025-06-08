// results-log.js
// Depends on ui-helpers.js for DOM access, setText, getText, showConfirmationModal, activateTab, updateSystemStatus
// Depends indirectly on data-updater.js for AppState (consider making this passed in or event-based)
// Depends on shutter-calcs.js for calculateAndDisplayComparison
// Global state for staging and buckets
const MAX_STAGING_ENTRIES = 50;
window.stagedResults = [];
window.resultBuckets = [];
let stagingResultIdCounter = 1;
let bucketIdCounter = 1;

// The calculateComparisonPercentage helper is now only in shutter-calcs.js
// and used internally by calculateAndDisplayComparison.

function addResultToStagingArea() {
    // Access AppState via window as in the original code, but ideally refactor later
    if (!window.AppState || !window.AppState.lastReceivedData) {
         console.warn("addResultToStagingArea called but no valid data available.");
        return;
    }


    // Ensure DOM elements exist
    if (!DOM.sensorModeSelector || !DOM.resultsLogTableBody || !DOM.stagingCount || !DOM.bucketNameInputStaging || !DOM.savedBucketsContainer || typeof window.showConfirmationModal !== 'function' || typeof getText !== 'function' || typeof updateSystemStatus !== 'function') {
         console.error("Results log initialization failed: Missing DOM elements or helper functions.");
         if (typeof window.updateSystemStatus === 'function') updateSystemStatus("UI Error: Cannot add result to staging.");
         return;
    }


    let currentModeText = DOM.sensorModeSelector.options[DOM.sensorModeSelector.selectedIndex]?.text.substring(0,10) || '---';

    const newResult = {
        id: `stage-${stagingResultIdCounter++}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        mode: currentModeText,
        // Use the getText helper from ui-helpers.js to get raw numeric values or '---'
        exp_s1_ms: getText('exp_ms_s1'),
        exp_s2_ms: getText('exp_ms_s2'),
        exp_s3_ms: getText('exp_ms_s3'),
        hz_s1: getText('hz_s1'), // ADDED: Hz per sensor
        hz_s2: getText('hz_s2'), // ADDED: Hz per sensor
        hz_s3: getText('hz_s3'), // ADDED: Hz per sensor
        avg_hz: getText('hz_avg'),
        // Store the segment curtain travel times
        c1_s1s2_ms: getText('ct_c1_s1s2_time'), // ADDED: Curtain 1, S1->S2
        c1_s2s3_ms: getText('ct_c1_s2s3_time'), // ADDED: Curtain 1, S2->S3
        c1_total_ms: getText('ct_c1_total_time'),
        c2_s1s2_ms: getText('ct_c2_s1s2_time'), // ADDED: Curtain 2, S1->S2
        c2_s2s3_ms: getText('ct_c2_s2s3_time'), // ADDED: Curtain 2, S2->S3
        c2_total_ms: getText('ct_c2_total_time'),
        full_open_duration_ms: getText('open_time_duration_ms'),
        slit_mm: getText('slit_width_mm'),
        // Note: Exp Var (%) stored here is the *instantaneous* variation calculated in data-updater
        // The averaged Exp Var in the bucket summary/deep dive will be the average of these instant values.
        exp_var_pct: getText('exp_var_pct')
    };

     // Prevent adding results that are all '---', unless it's just the compare values
     const hasMeaningfulData = Object.keys(newResult).some(key =>
         key !== 'id' && key !== 'timestamp' && key !== 'mode' &&
         newResult[key] !== '---' && newResult[key] !== null && typeof newResult[key] !== 'undefined' && String(newResult[key]).trim() !== ''
         // Also consider if specific critical values exist based on mode?
         // For simplicity now, just check if *any* calculated value is not '---'
         // Exclude per-sensor Hz from this check as they might be '---' in some modes but other data is valid
         && key !== 'hz_s1' && key !== 'hz_s2' && key !== 'hz_s3'
         // Exclude exp_var_pct if only one sensor is active
         && key !== 'exp_var_pct'
          // Exclude segment travel times if not in ALL mode
         && !((key === 'c1_s1s2_ms' || key === 'c1_s2s3_ms' || key === 'c2_s1s2_ms' || key === 'c2_s2s3_ms') && !currentModeText.includes("All"))
          // Exclude total travel, full open, slit if not in ALL or OUTER mode
         && !((key === 'c1_total_ms' || key === 'c2_total_ms' || key === 'full_open_duration_ms' || key === 'slit_mm') && currentModeText.includes("Inner"))
     );

     // Refined check: Ensure at least one exposure or total travel time is present and not '---' based on mode
     const hasRelevantMeasurement =
         (currentModeText.includes("All") && (newResult.exp_s1_ms !== '---' || newResult.exp_s2_ms !== '---' || newResult.exp_s3_ms !== '---' || newResult.c1_total_ms !== '---' || newResult.c2_total_ms !== '---')) ||
         (currentModeText.includes("Outer") && (newResult.exp_s1_ms !== '---' || newResult.exp_s3_ms !== '---' || newResult.c1_total_ms !== '---' || newResult.c2_total_ms !== '---')) ||
         (currentModeText.includes("Inner") && newResult.exp_s2_ms !== '---');

    if (!hasRelevantMeasurement) {
         console.warn("Attempted to add an empty or invalid result for the current mode to staging.");
         // Do not add if no meaningful data is present based on mode
         if (typeof window.updateSystemStatus === 'function') updateSystemStatus("Received invalid or empty data for current mode. Not added to staging.");
         return;
     }


    window.stagedResults.unshift(newResult);
    if (window.stagedResults.length > MAX_STAGING_ENTRIES) window.stagedResults.pop();
    renderStagingTable();
     if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus(`Result ${newResult.id} added to staging.`);
     else console.log(`Result ${newResult.id} added to staging.`);
}

function renderStagingTable() {
    if (!DOM.resultsLogTableBody || !DOM.stagingCount || typeof getText !== 'function') { console.error("Staging table body or count element not found!"); return; }
    DOM.resultsLogTableBody.innerHTML = '';
    DOM.stagingCount.textContent = window.stagedResults.length;

    window.stagedResults.forEach(entry => {
        const row = DOM.resultsLogTableBody.insertRow();
        row.classList.add('staging-row');
        row.draggable = true;
        row.dataset.resultId = entry.id;

        // Create cells in the correct order as defined by the table headers
        // We only display a subset of the stored data in the staging table for brevity
        const cellKeysInOrder = [
             'id', 'timestamp', 'mode',
             'exp_s1_ms', 'exp_s2_ms', 'exp_s3_ms', 'avg_hz', // Show individual exposures, overall speed
             // Do NOT show segment times in staging table, only totals for now
             'c1_total_ms', 'c2_total_ms',
             'full_open_duration_ms', 'slit_mm', 'exp_var_pct'
        ];

        cellKeysInOrder.forEach(key => {
            const cell = row.insertCell();
             // Handle displaying just the number for ID
             if (key === 'id') {
                 cell.textContent = entry[key].startsWith('stage-') ? entry[key].substring(6) : entry[key];
             } else {
                 // Use the value directly from the entry object
                 cell.textContent = entry[key] !== undefined ? entry[key] : '---';
             }
        });

        const actionCell = row.insertCell();
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.classList.add('action-button', 'danger');
        removeBtn.title = `Remove entry ${entry.id} from staging`;
        removeBtn.onclick = () => removeResultFromStaging(entry.id);
        actionCell.appendChild(removeBtn);
    });
     addDragListenersToStagingRows();
}

function removeResultFromStaging(resultId) {
    if (typeof window.showConfirmationModal !== 'function' || typeof updateSystemStatus !== 'function') { console.error("showConfirmationModal or updateSystemStatus not available."); return; }
    showConfirmationModal(`Remove staging entry ${resultId.startsWith('stage-') ? resultId.substring(6) : resultId}? This cannot be undone.`, (confirmed) => {
        if (confirmed) {
            window.stagedResults = window.stagedResults.filter(r => r.id !== resultId);
            renderStagingTable();
             updateSystemStatus(`Staging entry ${resultId.startsWith('stage-') ? resultId.substring(6) : resultId} removed.`);
        }
    });
}

function clearStagingArea() {
     // Ensure updateSystemStatus is available before trying to use it
     if (typeof window.updateSystemStatus !== 'function') {
         console.error("updateSystemStatus helper not available in clearStagingArea.");
         // Fallback to console log if updateSystemStatus is missing
         console.log("Staging area empty check. updateSystemStatus missing.");
         if (window.stagedResults.length === 0) {
             console.log("Staging area is already empty.");
         }
     } else {
         if (window.stagedResults.length === 0) {
             updateSystemStatus("Staging area is already empty.");
             return; // Exit if already empty
         }
     }


     // Ensure showConfirmationModal is available
     if (typeof window.showConfirmationModal !== 'function') {
         console.error("showConfirmationModal not available in clearStagingArea. Cannot confirm clear.");
         if (typeof window.updateSystemStatus === 'function') updateSystemStatus("UI Error: Confirmation modal missing.");
         return; // Exit if confirmation modal is missing
     }

    showConfirmationModal("Clear all unbucketed results from the staging area? This cannot be undone.", (confirmed) => {
        if (confirmed) {
            window.stagedResults = [];
            renderStagingTable();
            // Use updateSystemStatus if available, otherwise fallback to console.log
            if (typeof updateSystemStatus === 'function') {
                updateSystemStatus("Staging area cleared.");
            } else {
                console.log("Staging area cleared.");
            }
        }
    });
}

function createBucket() {
    if (!DOM.bucketNameInputStaging || !DOM.savedBucketsContainer || typeof window.showConfirmationModal !== 'function' || typeof updateSystemStatus !== 'function') { console.error("Bucket creation elements or helpers not found."); return; }
    const bucketName = DOM.bucketNameInputStaging.value.trim();
    if (!bucketName) {
        updateSystemStatus("Please enter a name for the bucket.");
        DOM.bucketNameInputStaging.focus();
        return;
    }
    if (window.stagedResults.length === 0) {
        updateSystemStatus("No results in staging area to create a bucket.");
        return;
    }
     if (window.resultBuckets.some(b => b.name.toLowerCase() === bucketName.toLowerCase())) { // Case-insensitive check
        updateSystemStatus(`Bucket "${bucketName}" already exists. Choose a different name.`);
        DOM.bucketNameInputStaging.focus();
        return;
    }

    const newBucket = {
        id: `bucket-${bucketIdCounter++}`,
        name: bucketName,
        createdAt: new Date().toLocaleString(),
        results: JSON.parse(JSON.stringify(window.stagedResults)), // Deep copy of current staged results
        averages: {}, // Calculated below
        comparisonAverages: {}, // Calculated below (these are average percentages, not used for deep dive display anymore)
        isExpanded: false
    };
    calculateBucketAverages(newBucket); // Calculate averages immediately upon creation
    window.resultBuckets.unshift(newBucket); // Add to the beginning
    window.stagedResults = []; // Clear staging
    DOM.bucketNameInputStaging.value = ''; // Clear input
    renderStagingTable(); // Re-render staging (now empty)
    renderSavedBuckets(); // Re-render the list of buckets (including the new one)
    updateSystemStatus(`Bucket "${bucketName}" created with ${newBucket.results.length} measurements.`);
}

function calculateBucketAverages(bucket) {
    const numEntries = bucket.results.length;
    // Ensure getText is available
    if (typeof getText !== 'function') {
        console.error("calculateBucketAverages failed: getText helper not available.");
        // Set defaults and return
         bucket.averages = {};
         bucket.comparisonAverages = {}; // Still keep this structure even if not used for deep dive display
        return;
    }

    const defaultAverages = {
        exp_s1_ms: '---', exp_s2_ms: '---', exp_s3_ms: '---',
        overall_exp_ms: '---', // ADDED: Overall average exposure
        hz_s1: '---', hz_s2: '---', hz_s3: '---', // ADDED: Hz per sensor
        avg_hz: '---', // Overall average Hz
        // ADDED the segment travel time keys
        c1_s1s2_ms: '---', c1_s2s3_ms: '---',
        c1_total_ms: '---',
        c2_s1s2_ms: '---', c2_s2s3_ms: '---',
        c2_total_ms: '---',
        full_open_duration_ms: '---',
        slit_mm: '---', exp_var_pct: '---'
    };
    bucket.averages = {...defaultAverages}; // Start with defaults

    // We still calculate comparison averages, but they are currently only displayed
    // as simple percentages in the bucket summary card, not the deep dive table.
    // The deep dive table recalculates comparisons using the *averaged* numeric values.
     const defaultComparisonAverages = {
         exp_s1s2_pct: NaN,
         exp_s2s3_pct: NaN,
         ct_c1_intra_pct: NaN, // C1 S1->S2 vs C1 S2->S3
         ct_c2_intra_pct: NaN, // C2 S1->S2 vs C2 S2->S3
         ct_c1c2_s1s2_pct: NaN, // C1 S1->S2 vs C2 S1->S2
         ct_c1c2_s2s3_pct: NaN, // C1 S2->S3 vs C2 S2->S3
         ct_c1c2_total_pct: NaN // C1 Total vs C2 Total
     };
     bucket.comparisonAverages = {...defaultComparisonAverages}; // Start with defaults


    if (numEntries === 0) return;

    // Keys to average, mapping to their base unit/precision for display
    const numericKeys = {
        exp_s1_ms: { unit: ' ms', dec: 3 }, exp_s2_ms: { unit: ' ms', dec: 3 }, exp_s3_ms: { unit: ' ms', dec: 3 },
        hz_s1: { unit: ' Hz', dec: 2 }, hz_s2: { unit: ' Hz', dec: 2 }, hz_s3: { unit: ' Hz', dec: 2 },
        avg_hz: { unit: ' Hz', dec: 2 },
        c1_s1s2_ms: { unit: ' ms', dec: 3 },
        c1_s2s3_ms: { unit: ' ms', dec: 3 },
        c1_total_ms: { unit: ' ms', dec: 3 },
        c2_s1s2_ms: { unit: ' ms', dec: 3 },
        c2_s2s3_ms: { unit: ' ms', dec: 3 },
        c2_total_ms: { unit: ' ms', dec: 3 },
        full_open_duration_ms: { unit: ' ms', dec: 3 },
        slit_mm: { unit: ' mm', dec: 2 }, exp_var_pct: { unit: ' %', dec: 2 }
    };

    const sums = Object.keys(numericKeys).reduce((acc, key) => {
        acc[key] = 0; acc[`count_${key}`] = 0; return acc;
    }, {});

    // Sums and counts for comparison percentages (only used for bucket summary display now)
     const compSums = Object.keys(defaultComparisonAverages).reduce((acc, key) => {
         acc[key] = 0; acc[`count_${key}`] = 0; return acc;
     }, {});

     // Sums for overall exposure average calculation later
     let overallExpSum = 0;
     let overallExpCount = 0;


    bucket.results.forEach(entry => {
        Object.keys(numericKeys).forEach(key => {
            // Use getText helper to get the raw number before units/symbols
            const num = parseFloat(getText(null, entry[key]));
            if (!isNaN(num) && isFinite(num)) {
                sums[key] += num;
                sums[`count_${key}`]++;
            }
        });

         // Accumulate for overall exposure average (average of sensor averages *per entry*)
         const entryExpValues = [
             parseFloat(getText(null, entry.exp_s1_ms)),
             parseFloat(getText(null, entry.exp_s2_ms)),
             parseFloat(getText(null, entry.exp_s3_ms))
         ].filter(num => !isNaN(num) && isFinite(num));

         if (entryExpValues.length > 0) {
             const entryAvgExp = entryExpValues.reduce((a,b)=>a+b,0) / entryExpValues.length;
             overallExpSum += entryAvgExp;
             overallExpCount++;
         }


         // Calculate individual comparison percentages for this entry and sum them up
         // Ensure getText is used correctly here to get numeric values
         const exp_s1_num = parseFloat(getText(null, entry.exp_s1_ms));
         const exp_s2_num = parseFloat(getText(null, entry.exp_s2_ms));
         const exp_s3_num = parseFloat(getText(null, entry.exp_s3_ms));
         const c1_s1s2_num = parseFloat(getText(null, entry.c1_s1s2_ms));
         const c1_s2s3_num = parseFloat(getText(null, entry.c1_s2s3_ms));
         const c1_total_num = parseFloat(getText(null, entry.c1_total_ms));
         const c2_s1s2_num = parseFloat(getText(null, entry.c2_s1s2_ms));
         const c2_s2s3_num = parseFloat(getText(null, entry.c2_s2s3_ms));
         const c2_total_num = parseFloat(getText(null, entry.c2_total_ms));


         // Exposure comparisons
         const comp_exp_s1s2 = calculateComparisonPercentage(exp_s1_num, exp_s2_num);
         if (!isNaN(comp_exp_s1s2)) { compSums.exp_s1s2_pct += comp_exp_s1s2; compSums.count_exp_s1s2_pct++; }

         const comp_exp_s2s3 = calculateComparisonPercentage(exp_s2_num, exp_s3_num);
         if (!isNaN(comp_exp_s2s3)) { compSums.exp_s2s3_pct += comp_exp_s2s3; compSums.count_exp_s2s3_pct++; }

         // Curtain travel comparisons
         const comp_ct_c1_intra = calculateComparisonPercentage(c1_s1s2_num, c1_s2s3_num);
         if (!isNaN(comp_ct_c1_intra)) { compSums.ct_c1_intra_pct += comp_ct_c1_intra; compSums.count_ct_c1_intra_pct++; }

         const comp_ct_c2_intra = calculateComparisonPercentage(c2_s1s2_num, c2_s2s3_num);
         if (!isNaN(comp_ct_c2_intra)) { compSums.ct_c2_intra_pct += comp_ct_c2_intra; compSums.count_ct_c2_intra_pct++; }

         const comp_c1c2_s1s2 = calculateComparisonPercentage(c1_s1s2_num, c2_s1s2_num);
         if (!isNaN(comp_c1c2_s1s2)) { compSums.ct_c1c2_s1s2_pct += comp_c1c2_s1s2; compSums.count_ct_c1c2_s1s2_pct++; }

         const comp_c1c2_s2s3 = calculateComparisonPercentage(c1_s2s3_num, c2_s2s3_num);
         if (!isNaN(comp_c1c2_s2s3)) { compSums.ct_c1c2_s2s3_pct += comp_c1c2_s2s3; compSums.count_ct_c1c2_s2s3_pct++; }

         const comp_c1c2_total = calculateComparisonPercentage(c1_total_num, c2_total_num);
         if (!isNaN(comp_c1c2_total)) { compSums.ct_c1c2_total_pct += comp_c1c2_total; compSums.count_ct_c1c2_total_pct++; }
    });

    // Calculate and format averages for numeric keys
    Object.keys(numericKeys).forEach(key => {
        const countKey = `count_${key}`;
        if (sums[countKey] > 0) {
            const avgValue = sums[key] / sums[countKey];
            // Special handling for Avg Hz if it results in Infinity or NaN (e.g. 0ms exposure)
             if (key === 'avg_hz' || key.startsWith('hz_s')) {
                  if (!isFinite(avgValue) || avgValue <= 0) { // Also check for <= 0 Hz, which is not meaningful
                      bucket.averages[key] = '---';
                  } else {
                      bucket.averages[key] = avgValue.toFixed(numericKeys[key].dec) + numericKeys[key].unit;
                  }
             }
            else if (!isFinite(avgValue)) {
                 bucket.averages[key] = '---';
            } else {
                 bucket.averages[key] = avgValue.toFixed(numericKeys[key].dec) + numericKeys[key].unit;
            }
        } else {
             bucket.averages[key] = '---'; // Set to '---' if no valid data points
        }
    });

    // Calculate and format overall average exposure
    if (overallExpCount > 0) {
        const avgValue = overallExpSum / overallExpCount;
         if (isFinite(avgValue)) {
            bucket.averages.overall_exp_ms = avgValue.toFixed(3) + ' ms';
         } else {
             bucket.averages.overall_exp_ms = '---';
         }
    } else {
        bucket.averages.overall_exp_ms = '---';
    }


     // Calculate and format average comparison percentages (for bucket summary only)
     const comparisonKeysToAverage = Object.keys(defaultComparisonAverages);
     comparisonKeysToAverage.forEach(key => {
         const countKey = `count_${key}`;
         if (compSums[countKey] > 0) {
             const avgCompValue = compSums[key] / compSums[countKey];
             // Store as number for calculateAndDisplayComparisonValue to format
             bucket.comparisonAverages[key] = parseFloat(avgCompValue.toFixed(1)); // Percentage to 1 decimal place
         } else {
             bucket.comparisonAverages[key] = NaN; // Set to NaN if no valid comparison data points
         }
     });
}


function renderSavedBuckets() {
    if (!DOM.savedBucketsContainer || typeof window.showConfirmationModal !== 'function' || typeof window.activateTab !== 'function' || typeof window.updateSystemStatus !== 'function') {
         console.error("Bucket rendering failed: Missing DOM elements or helper functions.");
         return;
    }
    DOM.savedBucketsContainer.innerHTML = '';
    if (window.resultBuckets.length === 0) {
        DOM.savedBucketsContainer.innerHTML = '<p style="text-align:center; color:#A0A0B0; grid-column: 1 / -1;">No measurement buckets saved yet.</p>';
        return;
    }

    window.resultBuckets.forEach(bucket => {
        const bucketDiv = document.createElement('div');
        bucketDiv.className = `bucket-item ${bucket.isExpanded ? 'expanded' : ''}`;
        bucketDiv.id = bucket.id; // Assign ID for potential direct lookup
        bucketDiv.dataset.bucketId = bucket.id; // Use data attribute for drag/drop target

        const header = document.createElement('div');
        header.className = 'bucket-header';
        // Main click on header toggles expansion
        header.onclick = (event) => {
            // Prevent toggle if a button inside header was clicked
            if (event.target.closest('button')) return;
            toggleBucketExpansion(bucket.id);
        };
        header.innerHTML = `
            <h5>${bucket.name}</h5>
            <span class="bucket-info">(${bucket.results.length} items, ${bucket.createdAt})</span>
            <div class="bucket-actions">
                <button class="action-button deep-dive-btn" title="View In-Depth Analysis">📊</button>
                <button class="action-button toggle-expand-btn" title="Expand/Collapse Details">${bucket.isExpanded ? 'Collapse ▲' : 'Expand ▼'}</button>
                <button class="action-button danger delete-bucket-btn" title="Delete Bucket">🗑️</button>
            </div>
        `;
        // Specific listeners for buttons to stop propagation and call their functions
        header.querySelector('.toggle-expand-btn').onclick = (e) => { e.stopPropagation(); toggleBucketExpansion(bucket.id); };
        header.querySelector('.delete-bucket-btn').onclick = (e) => { e.stopPropagation(); deleteBucket(bucket.id); };
        header.querySelector('.deep-dive-btn').onclick = (e) => { e.stopPropagation(); viewBucketDeepDive(bucket.id); };
        bucketDiv.appendChild(header);

        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'bucket-summary-averages'; // This is now the grid container
        let summaryGridHTML = '';

        // Define the 6 most important stats to show in the summary grid
        const summaryDisplayKeys = [
             'overall_exp_ms',      // Avg. Exposure (Overall)
             'avg_hz',              // Overall Avg. Speed
             'c1_total_ms',         // Avg. C1 Total Travel
             'c2_total_ms',         // Avg. C2 Total Travel
             'exp_var_pct',         // Avg. Exp Var (%)
             'ct_c1c2_total_pct'    // Avg. C1 vs C2 Total Diff (%)
        ];

        const avgLabels = {
            // Labels for the 6 summary stats
            overall_exp_ms: "Avg. Exposure",
            avg_hz: "Avg. Speed",
            c1_total_ms: "Avg. C1 Total",
            c2_total_ms: "Avg. C2 Total",
            exp_var_pct: "Avg. Exp Var",
            ct_c1c2_total_pct: "Avg. C1 vs C2 Total",

            // Other labels for deep dive/internal use (not used in this summary loop)
            exp_s1_ms: "Avg. Exp S1", exp_s2_ms: "Avg. Exp S2", exp_s3_ms: "Avg. Exp S3",
             hz_s1: "Avg. Speed S1", hz_s2: "Avg. Speed S2", hz_s3: "Avg. Speed S3",
             c1_s1s2_ms: "Avg. C1 S1→S2", c1_s2s3_ms: "Avg. C1 S2→S3",
             c2_s1s2_ms: "Avg. C2 S1→S2", c2_s2s3_ms: "Avg. C2 S2→S3",
            full_open_duration_ms: "Avg. Full Open", slit_mm: "Avg. Slit Width",

            // Comparison percentage labels (some used in summary, others only in deep dive)
            exp_s1s2_pct: "Avg. Exp S1 vs S2 Diff",
            exp_s2s3_pct: "Avg. Exp S2 vs S3 Diff",
             ct_c1_intra_pct: "Avg. C1 Intra-seg Diff",
             ct_c2_intra_pct: "Avg. C2 Intra-seg Diff",
             ct_c1c2_s1s2_pct: "Avg. C1 vs C2 S1→S2 Diff",
             ct_c1c2_s2s3_pct: "Avg. C1 vs C2 S2→S3 Diff",
            // ct_c1c2_total_pct: "Avg. C1 vs C2 Total Diff" // Using the shorter label "Avg. C1 vs C2 Total" for summary
        };


        // Iterate through the defined summary keys to build the HTML
        summaryDisplayKeys.forEach(key => {
            let label = avgLabels[key];
            let displayValue = '---'; // Default display

            // Prioritize numeric averages (strings like "Value Unit")
            if (bucket.averages.hasOwnProperty(key)) {
                 displayValue = bucket.averages[key];
            }
            // Then check comparison averages (numbers or NaN)
            else if (bucket.comparisonAverages.hasOwnProperty(key)) {
                const compValue = bucket.comparisonAverages[key];
                 if (typeof compValue === 'number' && isFinite(compValue)) {
                     displayValue = compValue.toFixed(1) + ' %'; // Always 1 decimal for % comparisons
                 }
                 // If compValue is NaN or not found, displayValue remains '---'
            }

            if (label) { // Only add if we have a label defined
                 summaryGridHTML += `<div class="average-grid-item"><span class="label">${label}:</span><span class="value">${displayValue}</span></div>`;
            } else {
                console.warn(`No label defined for summary key: ${key}`);
            }
        });


        summaryDiv.innerHTML = summaryGridHTML;
        bucketDiv.appendChild(summaryDiv);

        const expandedContentDiv = document.createElement('div');
        expandedContentDiv.className = 'bucket-expanded-content';
        if (bucket.isExpanded) {
            const detailsTable = document.createElement('table');
            detailsTable.className = 'bucket-details-table'; // Use general table styling
            // UPDATED table headers for expanded content to include segment times
            let detailsTableHTML = `<thead><tr>
                <th>#</th><th>Time</th><th>Mode</th>
                <th>Exp S1</th><th>Exp S2</th><th>Exp S3</th><th>Avg Speed</th>
                <th>C1 S1→S2</th><th>C1 S2→S3</th><th>C1 Total</th>
                <th>C2 S1→S2</th><th>C2 S2→S3</th><th>C2 Total</th>
                <th>FullOpen</th><th>Slit</th><th>Exp Var</th><th>Action</th>
            </tr></thead><tbody>`; // Adjusted Avg Hz to Avg Speed for consistency
            bucket.results.forEach(res => {
                 // Ensure all potentially missing keys have a default '---' display
                const id = res.id !== undefined ? (res.id.startsWith('stage-') ? res.id.substring(6) : res.id) : '---';
                const timestamp = res.timestamp !== undefined ? res.timestamp : '---';
                const mode = res.mode !== undefined ? res.mode : '---';
                const exp_s1_ms = res.exp_s1_ms !== undefined ? res.exp_s1_ms : '---';
                const exp_s2_ms = res.exp_s2_ms !== undefined ? res.exp_s2_ms : '---';
                const exp_s3_ms = res.exp_s3_ms !== undefined ? res.exp_s3_ms : '---';
                // Note: Displaying instant avg_hz, not the bucket's avg_hz here
                const avg_hz = res.avg_hz !== undefined ? res.avg_hz : '---';
                const c1_s1s2_ms = res.c1_s1s2_ms !== undefined ? res.c1_s1s2_ms : '---';
                // CORRECTED TYPO: Use res.c1_s2s3_ms for c1_s2s3_ms
                const c1_s2s3_ms = res.c1_s2s3_ms !== undefined ? res.c1_s2s3_ms : '---';
                const c1_total_ms = res.c1_total_ms !== undefined ? res.c1_total_ms : '---';
                const c2_s1s2_ms = res.c2_s1s2_ms !== undefined ? res.c2_s1s2_ms : '---';
                const c2_s2s3_ms = res.c2_s2s3_ms !== undefined ? res.c2_s2s3_ms : '---';
                const c2_total_ms = res.c2_total_ms !== undefined ? res.c2_total_ms : '---';
                const full_open_duration_ms = res.full_open_duration_ms !== undefined ? res.full_open_duration_ms : '---';
                const slit_mm = res.slit_mm !== undefined ? res.slit_mm : '---';
                const exp_var_pct = res.exp_var_pct !== undefined ? res.exp_var_pct : '---';


                detailsTableHTML += `<tr>
                    <td>${id}</td>
                    <td>${timestamp}</td>
                    <td>${mode}</td>
                    <td>${exp_s1_ms}</td>
                    <td>${exp_s2_ms}</td>
                    <td>${exp_s3_ms}</td>
                    <td>${avg_hz}</td>
                    <td>${c1_s1s2_ms}</td>
                    <td>${c1_s2s3_ms}</td>
                    <td>${c1_total_ms}</td>
                    <td>${c2_s1s2_ms}</td>
                    <td>${c2_s2s3_ms}</td>
                    <td>${c2_total_ms}</td>
                    <td>${full_open_duration_ms}</td>
                    <td>${slit_mm}</td>
                    <td>${exp_var_pct}</td>
                    <td><button class="action-button danger remove-from-bucket-btn" data-result-id="${res.id}">Remove</button></td>
                </tr>`;
            });
            detailsTableHTML += '</tbody>';
            detailsTable.innerHTML = detailsTableHTML;
            expandedContentDiv.appendChild(detailsTable);
            expandedContentDiv.querySelectorAll('.remove-from-bucket-btn').forEach(btn => {
                btn.onclick = (e) => { e.stopPropagation(); removeResultFromBucket(bucket.id, btn.dataset.resultId); };
            });
        }
        bucketDiv.appendChild(expandedContentDiv);
        DOM.savedBucketsContainer.appendChild(bucketDiv);
    });
    addDragListenersToBuckets();
}

function toggleBucketExpansion(bucketId) {
    const bucket = window.resultBuckets.find(b => b.id === bucketId);
    if (bucket) { bucket.isExpanded = !bucket.isExpanded; renderSavedBuckets(); }
}

function deleteBucket(bucketId) {
    if (typeof window.showConfirmationModal !== 'function' || typeof window.updateSystemStatus !== 'function') { console.error("Delete bucket helpers not available."); return; }
    const bucket = window.resultBuckets.find(b => b.id === bucketId);
    if (!bucket) return;
    showConfirmationModal(`Delete bucket "${bucket.name}" and all its ${bucket.results.length} measurements? This cannot be undone.`, (confirmed) => {
        if (confirmed) {
            window.resultBuckets = window.resultBuckets.filter(b => b.id !== bucketId);
            renderSavedBuckets();
            updateSystemStatus(`Bucket "${bucket.name}" deleted.`);
        }
    });
}

function removeResultFromBucket(bucketId, resultId) {
     if (typeof window.showConfirmationModal !== 'function' || typeof window.updateSystemStatus !== 'function') { console.error("Remove from bucket helpers not available."); return; }
    const bucket = window.resultBuckets.find(b => b.id === bucketId);
    if (!bucket) return;

     // Find the index of the result to remove
     const resultIndex = bucket.results.findIndex(r => r.id === resultId);
     if (resultIndex === -1) {
         console.warn(`Result ${resultId} not found in bucket ${bucketId}.`);
         return;
     }

    showConfirmationModal(`Remove result ${resultId.startsWith('stage-') ? resultId.substring(6) : resultId} from bucket "${bucket.name}"?`, (confirmed) => {
        if (confirmed) {
            // Remove the result using the found index
            bucket.results.splice(resultIndex, 1);

            calculateBucketAverages(bucket); // Recalculate averages after removal
            renderSavedBuckets(); // Re-render to reflect changes
            updateSystemStatus(`Result ${resultId.startsWith('stage-') ? resultId.substring(6) : resultId} removed from bucket "${bucket.name}".`);
             if (bucket.results.length === 0) updateSystemStatus(`Bucket "${bucket.name}" is now empty.`);
        }
    });
}

// This function populates the Bucket Deep Dive Tab table with averaged data
function viewBucketDeepDive(bucketId) {
    // Ensure necessary helpers are available
    if (!DOM.deepDiveBucketName || !DOM.bucketDeepDiveTabContent || typeof window.activateTab !== 'function' || typeof window.updateSystemStatus !== 'function' || typeof window.calculateAndDisplayComparison !== 'function' || typeof window.setText !== 'function' || typeof window.getText !== 'function') {
        console.error("Deep dive rendering failed: Missing DOM elements or helper functions.");
        // Attempt to activate the tab anyway so user sees it, perhaps with a message
         if (typeof window.activateTab === 'function') window.activateTab('bucketDeepDiveTab');
         if (typeof window.updateSystemStatus === 'function') updateSystemStatus("UI Error: Cannot render deep dive.");
         return;
    }
    const bucket = window.resultBuckets.find(b => b.id === bucketId);
    if (!bucket) {
        updateSystemStatus("Error: Bucket not found for deep dive.");
         // Ensure the tab is shown even if bucket is not found, perhaps clearing previous content
         window.activateTab('bucketDeepDiveTab');
         DOM.deepDiveBucketName.textContent = "Error: Bucket not found";
         // Clear table content? Maybe set all cells to '---'
         Object.keys(DOM).forEach(key => {
             if (key.startsWith('dd_')) setText(key, '---');
         });
        return;
    }

    DOM.deepDiveBucketName.textContent = `Deep Dive Analysis: ${bucket.name}`;
    const averages = bucket.averages;
    // comparisonAverages is no longer directly used for displaying comparison percentages here

    // Set average Exposure values
    setText('dd_exp_ms_s1', averages.exp_s1_ms);
    setText('dd_exp_ms_s2', averages.exp_s2_ms);
    setText('dd_exp_ms_s3', averages.exp_s3_ms);
    // Set Overall Average Exposure
    setText('dd_exp_ms_avg', averages.overall_exp_ms); // Now using the calculated overall average

    // Set average Shutter Speed (Hz) values per sensor and overall
    setText('dd_hz_s1', averages.hz_s1); // Now using calculated average Hz per sensor
    setText('dd_hz_s2', averages.hz_s2);
    setText('dd_hz_s3', averages.hz_s3);
    setText('dd_hz_avg', averages.avg_hz); // Overall average Hz


    // Display comparison percentages using calculateAndDisplayComparison on AVERAGED numeric values
    // Ensure calculateAndDisplayComparison is available globally
    if (typeof window.calculateAndDisplayComparison === 'function') {
         // Exposure Comparisons
         calculateAndDisplayComparison(averages.exp_s1_ms, averages.exp_s2_ms, 'dd_exp_compare_s1s2');
         calculateAndDisplayComparison(averages.exp_s2_ms, averages.exp_s3_ms, 'dd_exp_compare_s2s3');

         // Curtain Travel Comparisons
         // Intra-curtain (Segment vs Segment within the same curtain)
         calculateAndDisplayComparison(averages.c1_s1s2_ms, averages.c1_s2s3_ms, 'dd_ct_c1_intra_pct_var');
         calculateAndDisplayComparison(averages.c2_s1s2_ms, averages.c2_s2s3_ms, 'dd_ct_c2_intra_pct_var');

         // Inter-curtain (Curtain 1 vs Curtain 2 for the same segment/total)
         calculateAndDisplayComparison(averages.c1_s1s2_ms, averages.c2_s1s2_ms, 'dd_ct_c1c2_s1s2_compare_pct');
         calculateAndDisplayComparison(averages.c1_s2s3_ms, averages.c2_s2s3_ms, 'dd_ct_c1c2_s2s3_compare_pct');
         calculateAndDisplayComparison(averages.c1_total_ms, averages.c2_total_ms, 'dd_ct_c1c2_total_compare_pct');

    } else {
         console.error("calculateAndDisplayComparison function not found. Cannot display comparisons with symbols.");
         // Fallback: Display the average percentage from bucket.comparisonAverages as raw text if available
         // This falls back to the *previous* behavior (number only), but is better than nothing.
         setText('dd_exp_compare_s1s2', !isNaN(bucket.comparisonAverages.exp_s1s2_pct) ? `${bucket.comparisonAverages.exp_s1s2_pct}%` : '---');
         setText('dd_exp_compare_s2s3', !isNaN(bucket.comparisonAverages.exp_s2s3_pct) ? `${bucket.comparisonAverages.exp_s2s3_pct}%` : '---');
          setText('dd_ct_c1_intra_pct_var', !isNaN(bucket.comparisonAverages.ct_c1_intra_pct) ? `${bucket.comparisonAverages.ct_c1_intra_pct}%` : '---');
          setText('dd_ct_c2_intra_pct_var', !isNaN(bucket.comparisonAverages.ct_c2_intra_pct) ? `${bucket.comparisonAverages.ct_c2_intra_pct}%` : '---');
          setText('dd_ct_c1c2_s1s2_compare_pct', !isNaN(bucket.comparisonAverages.ct_c1c2_s1s2_pct) ? `${bucket.comparisonAverages.ct_c1c2_s1s2_pct}%` : '---');
          setText('dd_ct_c1c2_s2s3_compare_pct', !isNaN(bucket.comparisonAverages.ct_c1c2_s2s3_pct) ? `${bucket.comparisonAverages.ct_c1c2_s2s3_pct}%` : '---');
         setText('dd_ct_c1c2_total_compare_pct', !isNaN(bucket.comparisonAverages.ct_c1c2_total_pct) ? `${bucket.comparisonAverages.ct_c1c2_total_pct}%` : '---');
    }


    // Curtain travel times are averaged in the bucket averages
    // Now display the averaged segment times as well
    setText('dd_ct_c1_s1s2_time', averages.c1_s1s2_ms);
    setText('dd_ct_c1_s2s3_time', averages.c1_s2s3_ms);
    setText('dd_ct_c1_total_time', averages.c1_total_ms);
    setText('dd_ct_c2_s1s2_time', averages.c2_s1s2_ms);
    setText('dd_ct_c2_s2s3_time', averages.c2_s2s3_ms);
    setText('dd_ct_c2_total_time', averages.c2_total_ms);


    // Full open, slit width, and exposure variation averages
    setText('dd_open_time_duration_ms', averages.full_open_duration_ms);
    setText('dd_slit_width_mm', averages.slit_mm);
    setText('dd_exp_var_pct', averages.exp_var_pct); // This is the average of the individual Exp Var calcs

    // Activate the deep dive tab
    window.activateTab('bucketDeepDiveTab');
    updateSystemStatus(`Viewing deep dive for bucket "${bucket.name}".`);
}

let draggedResultId = null;
function addDragListenersToStagingRows() {
    // Ensure resultsLogTableBody exists before trying to add listeners
    if (!DOM.resultsLogTableBody) {
         console.warn("DOM.resultsLogTableBody not found, cannot add drag listeners to staging rows.");
         return;
    }
    // Attach listeners to tbody and use event delegation
    // Remove existing listeners first to prevent duplicates
    DOM.resultsLogTableBody.removeEventListener('dragstart', handleDragStart);
    DOM.resultsLogTableBody.removeEventListener('dragend', handleDragEnd);
    DOM.resultsLogTableBody.addEventListener('dragstart', handleDragStart);
    DOM.resultsLogTableBody.addEventListener('dragend', handleDragEnd);

     // Add draggable attribute to existing and future rows
     DOM.resultsLogTableBody.querySelectorAll('.staging-row').forEach(row => {
         row.draggable = true;
     });
}
function addDragListenersToBuckets() {
     // Ensure savedBucketsContainer exists before trying to add listeners
     if (!DOM.savedBucketsContainer) {
         console.warn("DOM.savedBucketsContainer not found, cannot add drag listeners to buckets.");
         return;
     }
    document.querySelectorAll('.bucket-item').forEach(bucketDiv => {
        // The drop zone is typically the header
        const dropZone = bucketDiv.querySelector('.bucket-header');
        if (!dropZone) return; // Must have a header to be a drop target

        // Remove existing listeners to prevent duplicates if renderSavedBuckets is called multiple times
        dropZone.removeEventListener('dragover', handleDragOver);
        dropZone.removeEventListener('dragleave', handleDragLeave);
        dropZone.removeEventListener('drop', handleDrop);

        // Add new listeners
        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('dragleave', handleDragLeave);
        dropZone.addEventListener('drop', handleDrop);
    });
}
function handleDragStart(event) {
    // Use event delegation: check if the actual target is a staging-row
    const targetRow = event.target.closest('.staging-row');
    if (!targetRow) return;

    draggedResultId = targetRow.dataset.resultId;
    event.target.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedResultId);
    // Optionally set a drag image
    // event.dataTransfer.setDragImage(event.target, 0, 0);

    if (typeof window.updateSystemStatus === 'function') updateSystemStatus(`Dragging result: ${draggedResultId.startsWith('stage-') ? draggedResultId.substring(6) : draggedResultId}`);
    else console.log(`Dragging result: ${draggedResultId}`);
}
function handleDragEnd(event) {
     // Use event delegation: check if the actual target was a staging-row
     const targetRow = event.target.closest('.staging-row');
     if (!targetRow) return;

    targetRow.classList.remove('dragging');
    draggedResultId = null; // Reset dragged state regardless of drop success

    // Remove drag-over class from all headers that might have it
    document.querySelectorAll('.bucket-item .bucket-header.drag-over').forEach(el => el.classList.remove('drag-over'));
     if (typeof window.updateSystemStatus === 'function') updateSystemStatus("Drag ended.");
     else console.log("Drag ended.");
}
function handleDragOver(event) {
    // Ensure the target is within a bucket header before allowing drop effects
    const dropTargetHeader = event.target.closest('.bucket-header');
    if (!dropTargetHeader) return; // Only allow drops on headers

    event.preventDefault(); // Necessary to allow dropping
    event.dataTransfer.dropEffect = 'move';

    // Add drag-over class only to the specific header
    dropTargetHeader.classList.add('drag-over');
}
function handleDragLeave(event) {
    // Check if the element the cursor left is still within the header or bucket item
    // Use event.target and event.relatedTarget with closest()
    const currentTargetHeader = event.currentTarget.closest('.bucket-header'); // The element the listener is on
    const relatedTargetHeader = event.relatedTarget ? event.relatedTarget.closest('.bucket-header') : null;

    if (currentTargetHeader && currentTargetHeader !== relatedTargetHeader) {
         // Cursor left the current header and did not enter another header directly
         // Also check if relatedTarget is outside the whole bucket-item
         const bucketItem = currentTargetHeader.closest('.bucket-item');
         if (bucketItem && !bucketItem.contains(event.relatedTarget)) {
             currentTargetHeader.classList.remove('drag-over');
         }
    }
}
function handleDrop(event) {
    event.preventDefault();
    const targetBucketElement = event.target.closest('.bucket-item');
    // Remove drag-over class immediately on drop attempt
    if (targetBucketElement) {
        const header = targetBucketElement.querySelector('.bucket-header');
        if(header) header.classList.remove('drag-over');
    }

    // Ensure drop occurred on a bucket item and we have a dragged ID
    if (!targetBucketElement || !draggedResultId) {
        console.error("Drop error: Missing target element or dragged result ID.");
         if (typeof window.updateSystemStatus === 'function') updateSystemStatus("Error moving result: Drop target invalid.");
        return;
    }

    const targetBucketId = targetBucketElement.dataset.bucketId;
    const resultToMoveIndex = window.stagedResults.findIndex(r => r.id === draggedResultId);
    const targetBucket = window.resultBuckets.find(b => b.id === targetBucketId);

    if (resultToMoveIndex > -1 && targetBucket) {
         const resultToMove = window.stagedResults[resultToMoveIndex];
        // Add result to the beginning of the bucket's results array
        targetBucket.results.unshift(JSON.parse(JSON.stringify(resultToMove))); // Deep copy
        calculateBucketAverages(targetBucket); // Recalculate averages
        // Remove result from staging using splice
        window.stagedResults.splice(resultToMoveIndex, 1);
        renderStagingTable();
        renderSavedBuckets(); // Re-render buckets to show updated count/averages
        if (typeof window.updateSystemStatus === 'function') updateSystemStatus(`Result ${draggedResultId.startsWith('stage-') ? draggedResultId.substring(6) : draggedResultId} moved to bucket "${targetBucket.name}".`);
        else console.log(`Result ${draggedResultId} moved to bucket "${targetBucket.name}".`);
    } else {
        console.error("Drop error: Result or bucket not found.", { draggedResultId, targetBucketId, resultIndex: resultToMoveIndex, targetBucket: !!targetBucket });
        if (typeof window.updateSystemStatus === 'function') updateSystemStatus("Error moving result: Result or bucket not found.");
    }
    // draggedResultId is already reset in handleDragEnd
}