function applyHexToFill(hexStr) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;

    var hex = hexStr.replace('#', '');
    var r = parseInt(hex.substring(0,2), 16) / 255;
    var g = parseInt(hex.substring(2,4), 16) / 255;
    var b = parseInt(hex.substring(4,6), 16) / 255;

    app.beginUndoGroup("Color Fill");
    for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        if (l instanceof ShapeLayer) {
            var contents = l.property("ADBE Root Vectors Group");
            for(var j = 1; j <= contents.numProperties; j++){
                var fill = contents.property(j).property("ADBE Vectors Group").property("ADBE Vector Graphic - Fill");
                if (fill) fill.property("ADBE Vector Fill Color").setValue([r,g,b,1]);
            }
        } else if (l instanceof TextLayer) {
            var textProp = l.property("Source Text");
            var textDoc = textProp.value;
            textDoc.fillColor = [r,g,b];
            textDoc.applyFill = true;
            textProp.setValue(textDoc);
        } else if (l.source && l.source.mainSource instanceof SolidSource) {
            l.source.mainSource.color = [r,g,b];
        }
    }
    app.endUndoGroup();
}

function applyHexToStroke(hexStr) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return;
    var layers = comp.selectedLayers;
    if (layers.length === 0) return;

    var hex = hexStr.replace('#', '');
    var r = parseInt(hex.substring(0,2), 16) / 255;
    var g = parseInt(hex.substring(2,4), 16) / 255;
    var b = parseInt(hex.substring(4,6), 16) / 255;

    app.beginUndoGroup("Color Stroke");
    for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        if (l instanceof ShapeLayer) {
            var contents = l.property("ADBE Root Vectors Group");
            for(var j = 1; j <= contents.numProperties; j++){
                var stroke = contents.property(j).property("ADBE Vectors Group").property("ADBE Vector Graphic - Stroke");
                if (stroke) stroke.property("ADBE Vector Stroke Color").setValue([r,g,b,1]);
            }
        } else if (l instanceof TextLayer) {
            var textProp = l.property("Source Text");
            var textDoc = textProp.value;
            textDoc.strokeColor = [r,g,b];
            textDoc.applyStroke = true;
            textProp.setValue(textDoc);
        }
    }
    app.endUndoGroup();
}