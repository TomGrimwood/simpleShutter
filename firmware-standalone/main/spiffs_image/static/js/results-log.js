// results-log.js
// Depends on ui-helpers.js for DOM access, setText, getText, showConfirmationModal, activateTab, updateSystemStatus
// Depends indirectly on data-updater.js for AppState (consider making this passed in or event-based)
// Global state for staging and buckets
const MAX_STAGING_ENTRIES = 50;
window.stagedResults = [];
window.resultBuckets = [];
let stagingResultIdCounter = 1;
let bucketIdCounter = 1;

function addResultToStagingArea() {
    // Access AppState via window as in the original code, but ideally refactor later
    if (!window.AppState || !window.AppState.lastReceivedData) return;

    // Ensure DOM elements exist
    if (!DOM.sensorModeSelector || !DOM.resultsLogTableBody || !DOM.stagingCount || !DOM.bucketNameInputStaging || !DOM.savedBucketsContainer || typeof window.showConfirmationModal !== 'function') {
         console.error("Results log initialization failed: Missing DOM elements or helper functions.");
         // Cannot proceed with adding result if critical UI components are missing
         return;
    }


    let currentModeText = DOM.sensorModeSelector.options[DOM.sensorModeSelector.selectedIndex]?.text.substring(0,10) || '---';
    const newResult = {
        id: `stage-${stagingResultIdCounter++}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        mode: currentModeText,
        // Use the getText helper from ui-helpers.js
        exp_s1_ms: getText('exp_ms_s1'), exp_s2_ms: getText('exp_ms_s2'), exp_s3_ms: getText('exp_ms_s3'),
        avg_hz: getText('hz_avg'),
        c1_total_ms: getText('ct_c1_total_time'), c2_total_ms: getText('ct_c2_total_time'),
        full_open_duration_ms: getText('open_time_duration_ms'),
        slit_mm: getText('slit_width_mm'), exp_var_pct: getText('exp_var_pct')
    };
    window.stagedResults.unshift(newResult);
    if (window.stagedResults.length > MAX_STAGING_ENTRIES) window.stagedResults.pop();
    renderStagingTable();
}

function renderStagingTable() {
    if (!DOM.resultsLogTableBody || !DOM.stagingCount) { console.error("Staging table body or count element not found!"); return; }
    DOM.resultsLogTableBody.innerHTML = '';
    DOM.stagingCount.textContent = window.stagedResults.length;

    window.stagedResults.forEach(entry => {
        const row = DOM.resultsLogTableBody.insertRow();
        row.classList.add('staging-row');
        row.draggable = true;
        row.dataset.resultId = entry.id;

        // Create cells in the correct order as defined by the table headers
        const keysInOrder = ['id', 'timestamp', 'mode', 'exp_s1_ms', 'exp_s2_ms', 'exp_s3_ms', 'avg_hz', 'c1_total_ms', 'c2_total_ms', 'full_open_duration_ms', 'slit_mm', 'exp_var_pct'];
        keysInOrder.forEach(key => {
            const cell = row.insertCell();
             // Handle displaying just the number for ID
             if (key === 'id') {
                 cell.textContent = entry[key].startsWith('stage-') ? entry[key].substring(6) : entry[key];
             } else {
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
    if (typeof window.showConfirmationModal !== 'function') { console.error("showConfirmationModal not available."); return; }
    showConfirmationModal(`Remove staging entry ${resultId}? This cannot be undone.`, (confirmed) => {
        if (confirmed) {
            window.stagedResults = window.stagedResults.filter(r => r.id !== resultId);
            renderStagingTable();
             if (typeof window.updateSystemStatus === 'function') window.updateSystemStatus(`Staging entry ${resultId} removed.`);
             else console.log(`Staging entry ${resultId} removed.`);
        }
    });
}

function clearStagingArea() {
     if (window.stagedResults.length === 0) {
        if (typeof window.updateSystemStatus === 'function') updateSystemStatus("Staging area is already empty.");
        else console.log("Staging area is already empty.");
        return;
    }
     if (typeof window.showConfirmationModal !== 'function') { console.error("showConfirmationModal not available."); return; }
    showConfirmationModal("Clear all unbucketed results from the staging area? This cannot be undone.", (confirmed) => {
        if (confirmed) {
            window.stagedResults = [];
            renderStagingTable();
            if (typeof window.updateSystemStatus === 'function') updateSystemStatus("Staging area cleared.");
             else console.log("Staging area cleared.");
        }
    });
}

function createBucket() {
    if (!DOM.bucketNameInputStaging || !DOM.savedBucketsContainer) { console.error("Bucket creation elements not found."); return; }
    const bucketName = DOM.bucketNameInputStaging.value.trim();
    if (!bucketName) {
        if (typeof window.updateSystemStatus === 'function') updateSystemStatus("Please enter a name for the bucket.");
        DOM.bucketNameInputStaging.focus();
        return;
    }
    if (window.stagedResults.length === 0) {
        if (typeof window.updateSystemStatus === 'function') updateSystemStatus("No results in staging area to create a bucket.");
        return;
    }
     if (window.resultBuckets.some(b => b.name === bucketName)) {
        if (typeof window.updateSystemStatus === 'function') updateSystemStatus(`Bucket "${bucketName}" already exists. Choose a different name.`);
        DOM.bucketNameInputStaging.focus();
        return;
    }

    const newBucket = {
        id: `bucket-${bucketIdCounter++}`,
        name: bucketName,
        createdAt: new Date().toLocaleString(),
        results: JSON.parse(JSON.stringify(window.stagedResults)), // Deep copy
        averages: {},
        isExpanded: false
    };
    calculateBucketAverages(newBucket);
    window.resultBuckets.unshift(newBucket); // Add to the beginning
    window.stagedResults = []; // Clear staging
    DOM.bucketNameInputStaging.value = ''; // Clear input
    renderStagingTable();
    renderSavedBuckets();
    if (typeof window.updateSystemStatus === 'function') updateSystemStatus(`Bucket "${bucketName}" created with ${newBucket.results.length} measurements.`);
     else console.log(`Bucket "${bucketName}" created with ${newBucket.results.length} measurements.`);
}

function calculateBucketAverages(bucket) {
    const numEntries = bucket.results.length;
    const defaultAverages = {
        exp_s1_ms: '---', exp_s2_ms: '---', exp_s3_ms: '---', avg_hz: '---',
        c1_total_ms: '---', c2_total_ms: '---', full_open_duration_ms: '---',
        slit_mm: '---', exp_var_pct: '---'
    };
    bucket.averages = {...defaultAverages}; // Start with defaults

    if (numEntries === 0) return;

    // Keys to average, mapping to their base unit/precision for display
    const numericKeys = {
        exp_s1_ms: { unit: ' ms', dec: 3 }, exp_s2_ms: { unit: ' ms', dec: 3 }, exp_s3_ms: { unit: ' ms', dec: 3 },
        avg_hz: { unit: ' Hz', dec: 2 },
        c1_total_ms: { unit: ' ms', dec: 3 }, c2_total_ms: { unit: ' ms', dec: 3 },
        full_open_duration_ms: { unit: ' ms', dec: 3 },
        slit_mm: { unit: ' mm', dec: 2 }, exp_var_pct: { unit: ' %', dec: 2 }
    };

    const sums = Object.keys(numericKeys).reduce((acc, key) => {
        acc[key] = 0; acc[`count_${key}`] = 0; return acc;
    }, {});

    bucket.results.forEach(entry => {
        Object.keys(numericKeys).forEach(key => {
            // Use getText helper to get the raw number before units/symbols
            const num = parseFloat(getText(null, entry[key])); // Pass null for DOM element ID, use entry value directly
            if (!isNaN(num) && isFinite(num)) {
                sums[key] += num;
                sums[`count_${key}`]++;
            }
        });
    });

    Object.keys(numericKeys).forEach(key => {
        const countKey = `count_${key}`;
        if (sums[countKey] > 0) {
            const avgValue = sums[key] / sums[countKey];
            bucket.averages[key] = avgValue.toFixed(numericKeys[key].dec) + numericKeys[key].unit;
        }
    });

     // Re-calculate Exp Var % based on averages for consistency, if needed
     // Or calculate it based on the variance of the original results if a true bucket variance is desired.
     // For simplicity, let's assume the average of the calculated exp_var_pct is sufficient for the summary display.
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
        const avgLabels = {
            exp_s1_ms: "Avg. Exp S1", exp_s2_ms: "Avg. Exp S2", exp_s3_ms: "Avg. Exp S3",
            avg_hz: "Overall Avg. Speed", c1_total_ms: "Avg. C1 Total", c2_total_ms: "Avg. C2 Total",
            full_open_duration_ms: "Avg. Full Open", slit_mm: "Avg. Slit Width", exp_var_pct: "Avg. Exp Var"
        };
        for (const key in bucket.averages) {
            if (avgLabels[key]) {
                 summaryGridHTML += `<div class="average-grid-item"><span class="label">${avgLabels[key]}:</span><span class="value">${bucket.averages[key]}</span></div>`;
            }
        }
        summaryDiv.innerHTML = summaryGridHTML;
        bucketDiv.appendChild(summaryDiv);

        const expandedContentDiv = document.createElement('div');
        expandedContentDiv.className = 'bucket-expanded-content';
        if (bucket.isExpanded) {
            const detailsTable = document.createElement('table');
            detailsTable.className = 'bucket-details-table'; // Use general table styling
            let detailsTableHTML = `<thead><tr>
                <th>#</th><th>Time</th><th>Mode</th><th>Exp S1</th><th>Exp S2</th><th>Exp S3</th>
                <th>Avg Hz</th><th>C1 Total</th><th>C2 Total</th><th>FullOpen</th><th>Slit</th><th>Exp Var</th><th>Action</th>
            </tr></thead><tbody>`;
            bucket.results.forEach(res => {
                detailsTableHTML += `<tr>
                    <td>${res.id.startsWith('stage-') ? res.id.substring(6) : res.id}</td><td>${res.timestamp}</td><td>${res.mode}</td>
                    <td>${res.exp_s1_ms}</td><td>${res.exp_s2_ms}</td><td>${res.exp_s3_ms}</td>
                    <td>${res.avg_hz}</td><td>${res.c1_total_ms}</td><td>${res.c2_total_ms}</td>
                    <td>${res.full_open_duration_ms}</td><td>${res.slit_mm}</td><td>${res.exp_var_pct}</td>
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
    showConfirmationModal(`Remove result ${resultId} from bucket "${bucket.name}"?`, (confirmed) => {
        if (confirmed) {
            bucket.results = bucket.results.filter(r => r.id !== resultId);
            calculateBucketAverages(bucket); // Recalculate averages after removal
            renderSavedBuckets(); // Re-render to reflect changes
            updateSystemStatus(`Result ${resultId} removed from bucket "${bucket.name}".`);
             if (bucket.results.length === 0) updateSystemStatus(`Bucket "${bucket.name}" is now empty.`);
        }
    });
}

// This function relies on calculateAndDisplayComparison from shutter-calcs.js
function viewBucketDeepDive(bucketId) {
    if (!DOM.deepDiveBucketName || !DOM.bucketDeepDiveTabContent || typeof window.activateTab !== 'function' || typeof window.updateSystemStatus !== 'function' || typeof window.calculateAndDisplayComparison !== 'function' || typeof window.setText !== 'function' || typeof window.getText !== 'function') {
        console.error("Deep dive rendering failed: Missing DOM elements or helper functions.");
        return;
    }
    const bucket = window.resultBuckets.find(b => b.id === bucketId);
    if (!bucket) { updateSystemStatus("Error: Bucket not found for deep dive."); return; }

    DOM.deepDiveBucketName.textContent = `Deep Dive Analysis: ${bucket.name}`;
    const averages = bucket.averages;

    // Helper to parse numeric value from string like "123.45 ms" using getText helper
    const parseAvgValue = (avgStr) => parseFloat(getText(null, avgStr));


    setText('dd_exp_ms_s1', averages.exp_s1_ms);
    setText('dd_exp_ms_s2', averages.exp_s2_ms);
    setText('dd_exp_ms_s3', averages.exp_ms_s3); // Fixed typo here (was exp_ms_avg)


    const avg_exp_s1_num = parseAvgValue(averages.exp_s1_ms);
    const avg_exp_s2_num = parseAvgValue(averages.exp_ms_s2); // Fixed typo here (was exp_ms_s2)
    const avg_exp_s3_num = parseAvgValue(averages.exp_ms_s3);

     // Calculate overall average from available sensor averages
     let validExps = [];
     if(!isNaN(avg_exp_s1_num)) validExps.push(avg_exp_s1_num);
     if(!isNaN(avg_exp_s2_num)) validExps.push(avg_exp_s2_num);
     if(!isNaN(avg_exp_s3_num)) validExps.push(avg_exp_s3_num);

     const overallAvgExp = validExps.length > 0 ? (validExps.reduce((a, b) => a + b, 0) / validExps.length) : null;
     setText('dd_exp_ms_avg', overallAvgExp, 3, ' ms');


    // Recalculate Hz from averaged ms if needed, or just use the average Hz provided by calculateBucketAverages
    // Using the pre-calculated average Hz is simpler and likely intended
    setText('dd_hz_s1', getText(null, averages.exp_s1_ms) !== '---' ? (1000 / parseAvgValue(averages.exp_s1_ms)).toFixed(2) + ' Hz' : '---'); // Recalculating Hz per sensor average
    setText('dd_hz_s2', getText(null, averages.exp_ms_s2) !== '---' ? (1000 / parseAvgValue(averages.exp_ms_s2)).toFixed(2) + ' Hz' : '---'); // Recalculating Hz per sensor average
    setText('dd_hz_s3', getText(null, averages.exp_ms_s3) !== '---' ? (1000 / parseAvgValue(averages.exp_ms_s3)).toFixed(2) + ' Hz' : '---'); // Recalculating Hz per sensor average
    setText('dd_hz_avg', averages.avg_hz); // Using the averaged Hz


    if (!isNaN(avg_exp_s1_num) && !isNaN(avg_exp_s2_num)) calculateAndDisplayComparison(avg_exp_s1_num, avg_exp_s2_num, 'exp_compare_s1s2', true);
    else setText('dd_exp_compare_s1s2', '---');
    if (!isNaN(avg_exp_s2_num) && !isNaN(avg_exp_s3_num)) calculateAndDisplayComparison(avg_exp_s2_num, avg_exp_s3_num, 'exp_compare_s2s3', true);
    else setText('dd_exp_compare_s2s3', '---');

    // Curtain travel times are averaged as total S1->S3 in the bucket averages
    // The S1->S2 and S2->S3 breakdowns are not directly available from the bucket averages
    setText('dd_ct_c1_s1s2_time', '---'); // Not available from bucket average
    setText('dd_ct_c1_s2s3_time', '---'); // Not available from bucket average
    setText('dd_ct_c1_total_time', averages.c1_total_ms);
    setText('dd_ct_c2_s1s2_time', '---'); // Not available from bucket average
    setText('dd_ct_c2_s2s3_time', '---'); // Not available from bucket average
    setText('dd_ct_c2_total_time', averages.c2_total_ms);

    // Intra-segment comparisons not available from bucket average
    setText('dd_ct_c1_intra_pct_var', '---');
    setText('dd_ct_c2_intra_pct_var', '---');

    // C1 vs C2 comparisons on segments not available from bucket average
    setText('dd_ct_c1c2_s1s2_compare_pct', '---');
    setText('dd_ct_c1c2_s2s3_compare_pct', '---');

    // C1 vs C2 total comparison
    const c1_total_num = parseAvgValue(averages.c1_total_ms);
    const c2_total_num = parseAvgValue(averages.c2_total_ms);
     if (!isNaN(c1_total_num) && !isNaN(c2_total_num)) calculateAndDisplayComparison(c1_total_num, c2_total_num, 'ct_c1c2_total_compare_pct', true);
    else setText('dd_ct_c1c2_total_compare_pct', '---');

    setText('dd_open_time_duration_ms', averages.full_open_duration_ms);
    setText('dd_slit_width_mm', averages.slit_mm);
    setText('dd_exp_var_pct', averages.exp_var_pct); // This is the average of the individual Exp Var calcs

    // Activate the deep dive tab
    window.activateTab('bucketDeepDiveTab');
}

let draggedResultId = null;
function addDragListenersToStagingRows() {
    document.querySelectorAll('.staging-row').forEach(row => {
        row.addEventListener('dragstart', handleDragStart);
        row.addEventListener('dragend', handleDragEnd);
    });
}
function addDragListenersToBuckets() {
    document.querySelectorAll('.bucket-item').forEach(bucketDiv => {
        // The drop zone is typically the header, but can also be the whole item
        const dropZone = bucketDiv.querySelector('.bucket-header') || bucketDiv;
        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('dragleave', handleDragLeave);
        dropZone.addEventListener('drop', handleDrop);
    });
}
function handleDragStart(event) {
    draggedResultId = event.target.dataset.resultId;
    event.target.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedResultId);
    if (typeof window.updateSystemStatus === 'function') updateSystemStatus(`Dragging result: ${draggedResultId}`);
    else console.log(`Dragging result: ${draggedResultId}`);
}
function handleDragEnd(event) {
    event.target.classList.remove('dragging');
    draggedResultId = null;
    // Remove drag-over class from all headers that might have it
    document.querySelectorAll('.bucket-item .bucket-header.drag-over').forEach(el => el.classList.remove('drag-over'));
     if (typeof window.updateSystemStatus === 'function') updateSystemStatus("Drag ended.");
     else console.log("Drag ended.");
}
function handleDragOver(event) {
    event.preventDefault(); // Necessary to allow dropping
    event.dataTransfer.dropEffect = 'move';
    const dropTargetHeader = event.target.closest('.bucket-header');
    if (dropTargetHeader) dropTargetHeader.classList.add('drag-over');
}
function handleDragLeave(event) {
    const dropTargetHeader = event.target.closest('.bucket-header');
    if (dropTargetHeader) dropTargetHeader.classList.remove('drag-over');
}
function handleDrop(event) {
    event.preventDefault();
    const targetBucketElement = event.target.closest('.bucket-item');
    // Remove drag-over class immediately on drop attempt
    if (targetBucketElement) {
        const header = targetBucketElement.querySelector('.bucket-header');
        if(header) header.classList.remove('drag-over');
    }

    if (!targetBucketElement || !draggedResultId) {
        console.error("Drop error: Missing target element or dragged result ID.");
         if (typeof window.updateSystemStatus === 'function') updateSystemStatus("Error moving result.");
        return;
    }

    const targetBucketId = targetBucketElement.dataset.bucketId;
    const resultToMove = window.stagedResults.find(r => r.id === draggedResultId);
    const targetBucket = window.resultBuckets.find(b => b.id === targetBucketId);

    if (resultToMove && targetBucket) {
        // Add result to the beginning of the bucket's results array
        targetBucket.results.unshift(JSON.parse(JSON.stringify(resultToMove)));
        calculateBucketAverages(targetBucket); // Recalculate averages
        // Remove result from staging
        window.stagedResults = window.stagedResults.filter(r => r.id !== draggedResultId);
        renderStagingTable();
        renderSavedBuckets();
        if (typeof window.updateSystemStatus === 'function') updateSystemStatus(`Result ${draggedResultId} moved to bucket "${targetBucket.name}".`);
        else console.log(`Result ${draggedResultId} moved to bucket "${targetBucket.name}".`);
    } else {
        console.error("Drop error: Result or bucket not found.", { draggedResultId, targetBucketId, resultToMove: !!resultToMove, targetBucket: !!targetBucket });
        if (typeof window.updateSystemStatus === 'function') updateSystemStatus("Error moving result.");
    }
    draggedResultId = null; // Reset dragged state
}