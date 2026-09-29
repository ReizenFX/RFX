// ----------------------------------------------------------------------------
// TRACKER MODULE BACKEND
// ----------------------------------------------------------------------------
// ExtendScript Host Connectivity for Live Tracking
function getTrackerState() {
    try {
        var pName = "No Project Open";
        var isRend = "false";
        
        if (app && app.project) {
            if (app.project.file) {
                var rawName = app.project.file.name;
                // Safely decode URI, fallback to raw name if it fails
                try { pName = decodeURI(rawName); } 
                catch(e) { pName = rawName; }
                
                // Strip the .aep extension
                var dotIndex = pName.lastIndexOf('.');
                if (dotIndex > -1) { pName = pName.substring(0, dotIndex); }
            } else {
                pName = "Untitled Project";
            }
            
            // Check Render Status
            if (app.project.renderQueue) {
                for (var i = 1; i <= app.project.renderQueue.numItems; i++) {
                    if (app.project.renderQueue.item(i).status === RQItemStatus.RENDERING) {
                        isRend = "true";
                        break;
                    }
                }
            }
        }
        
        pName = pName.replace(/\|/g, '').replace(/\n/g, '').replace(/\r/g, ''); 
        return pName + "|||" + isRend;
    } catch (err) {
        return "AE_BUSY|||false";
    }
}
