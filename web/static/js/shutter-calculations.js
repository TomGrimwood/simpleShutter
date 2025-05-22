function calculateAndDisplayComparison(val1, val2, targetCellId) {
    var el = document.getElementById(targetCellId);
    if (!el) return;

    // Check for non-numeric string constants or null/undefined directly on inputs
    if (val1 === null || typeof val1 === 'undefined' || String(val1).toLowerCase() === 'n/a' || String(val1).toLowerCase() === '---' ||
        val2 === null || typeof val2 === 'undefined' || String(val2).toLowerCase() === 'n/a' || String(val2).toLowerCase() === '---') {
        el.textContent = 'N/A';
        return;
    }

    var num1 = parseFloat(String(val1)); // String() handles potential non-string inputs safely
    var num2 = parseFloat(String(val2));

    // Check for NaN or Infinity post-parsing. isFinite handles NaN, Infinity, -Infinity.
    if (!isFinite(num1) || !isFinite(num2)) {
        el.textContent = 'N/A';
        return;
    }
    
    var diffPercent = 0;
    // Handle comparison with zero carefully to avoid division by zero or misleading percentages.
    if (num1 === num2) { // Handles (0,0) and (X,X)
        diffPercent = 0;
    } else {
        var avgForDiff = (Math.abs(num1) + Math.abs(num2)) / 2;
        // If average is effectively zero, but numbers are different (e.g. 0 vs 0.001)
        if (avgForDiff < 1e-9) { 
            if (Math.abs(num1) > 1e-9 || Math.abs(num2) > 1e-9) { // One is non-zero, other is zero/tiny
                 diffPercent = 100.0; // Effectively infinite percent difference from a zero/tiny base
            } else { // Both numbers are extremely small and considered zero for practical purposes
                diffPercent = 0;
            }
        } else {
            diffPercent = Math.abs(num1 - num2) / avgForDiff * 100;
        }
    }
    
    let symbol = "";
    let titleText = "";
    const tolerance = 0.05; // if diffPercent < 0.05, values are considered "approximately equal"

    const isC1C2DiffRowCell = targetCellId === 'ct_c1c2_s1s2_compare_pct' || 
                              targetCellId === 'ct_c1c2_s2s3_compare_pct' || 
                              targetCellId === 'ct_c1c2_total_compare_pct';

    let val1_desc = "Value 1"; // Default descriptor
    let val2_desc = "Value 2"; // Default descriptor

    // Determine descriptive names for values being compared based on target cell
    if (isC1C2DiffRowCell) {
        val1_desc = "C1 time";
        val2_desc = "C2 time";
    } else {
        switch (targetCellId) {
            case 'exp_compare_s1s2':
                val1_desc = "S1 exposure"; val2_desc = "S2 exposure"; break;
            case 'exp_compare_s2s3':
                val1_desc = "S2 exposure"; val2_desc = "S3 exposure"; break;
            case 'ct_c1_intra_pct_var': // Curtain 1: S1-S2 segment vs S2-S3 segment
                val1_desc = "C1 S1→S2 time"; val2_desc = "C1 S2→S3 time"; break;
            case 'ct_c2_intra_pct_var': // Curtain 2: S1-S2 segment vs S2-S3 segment
                val1_desc = "C2 S1→S2 time"; val2_desc = "C2 S2→S3 time"; break;
        }
    }
    // Note: All values currently compared by this function are times in 'ms', so "faster/slower" context is appropriate.

    if (diffPercent < tolerance) {
        symbol = "≈";
        if (num1 === num2) { // Handles exact equality, including 0 vs 0
             titleText = `${val1_desc} and ${val2_desc} are equal (${num1.toFixed(3)}ms).`;
        } else {
             let speedContext = "";
             if (num1 < num2) speedContext = ` (${val1_desc} is faster).`;
             else if (num1 > num2) speedContext = ` (${val1_desc} is slower).`; // num1 > num2
             titleText = `${val1_desc} (${num1.toFixed(3)}ms) and ${val2_desc} (${num2.toFixed(3)}ms) are very close${speedContext} Difference is ${diffPercent.toFixed(1)}% of their average.`;
        }
    } else if (isC1C2DiffRowCell) {
        // For C1 vs C2 Diff row, up/down arrows point to the LARGER value.
        // val1 is C1 time, val2 is C2 time.
        if (num1 < num2) { // num2 (C2 time) is larger (slower). Arrow "points to" C2 (the larger value). Use ↓.
            symbol = "↓"; 
            titleText = `${val2_desc} (${num2.toFixed(3)}ms) is larger (slower) than ${val1_desc} (${num1.toFixed(3)}ms). Arrow indicates ${val2_desc} is the larger/slower one. Difference: ${diffPercent.toFixed(1)}% of their average.`;
        } else { // num1 > num2. num1 (C1 time) is larger (slower). Arrow "points to" C1 (the larger value). Use ↑.
            symbol = "↑";
            titleText = `${val1_desc} (${num1.toFixed(3)}ms) is larger (slower) than ${val2_desc} (${num2.toFixed(3)}ms). Arrow indicates ${val1_desc} is the larger/slower one. Difference: ${diffPercent.toFixed(1)}% of their average.`;
        }
    } else {
        // For other rows, use < > symbols.
        if (num1 < num2) {
            symbol = "<";
            titleText = `${val1_desc} (${num1.toFixed(3)}ms) is less than (faster than) ${val2_desc} (${num2.toFixed(3)}ms). Difference is ${diffPercent.toFixed(1)}% of their average.`;
        } else { // num1 > num2
            symbol = ">";
            titleText = `${val1_desc} (${num1.toFixed(3)}ms) is greater than (slower than) ${val2_desc} (${num2.toFixed(3)}ms). Difference is ${diffPercent.toFixed(1)}% of their average.`;
        }
    }
    
    // Ensure title attribute is HTML-safe (escape double quotes)
    el.innerHTML = `<span title="${titleText.replace(/"/g, '"')}">${symbol} (${diffPercent.toFixed(1)}%)</span>`;
}

function formatRawTimestamp(value_us, unit) {
    if (value_us === null || typeof value_us === 'undefined') return 'N/A';
    var num_us = Number(value_us);
    if (isNaN(num_us)) return 'N/A';
    switch (unit) {
        case 'ms': return (num_us / 1000.0).toFixed(3);
        case 's': return (num_us / 1000000.0).toFixed(6);
        case 'us': default: return num_us.toString();
    }
}