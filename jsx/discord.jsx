// ============================================================================
// DISCORD RPC MODULE - EXACT ORIGINAL LOGIC
// ============================================================================
function getDiscordAppId() {
    try {
        var n = app.name.toLowerCase();
        if (n.indexOf("after effects") !== -1) return "AEFT";
        if (n.indexOf("premiere") !== -1) return "PPRO";
        if (n.indexOf("photoshop") !== -1) return "PHXS";
    } catch(e) {}
    return "AEFT";
}

function getDetails() {
    var host = getDiscordAppId();
    try {
        if (host === "AEFT") return decodeURIComponent(app.project.file.name);
        if (host === "PPRO") {
            if (app.project && app.project.file && app.project.file.name) return decodeURIComponent(app.project.file.name);
            else if (app.project && app.project.name) return app.project.name;
        }
        if (host === "PHXS") return app.activeDocument.name;
    } catch (e) {}
    if (host === "AEFT") return 'Untitled Project.aep';
    if (host === "PPRO") return 'Untitled.prproj';
    if (host === "PHXS") return 'Untitled.psd';
    return 'Idling.';
}

function getState() {
    var host = getDiscordAppId();
    try {
        if (host === "AEFT") {
            var activeItem = app.project.activeItem;
            // The hardcoded 5x Streak has been removed.
            // It just returns the composition name now.
            if (activeItem && activeItem instanceof CompItem) return activeItem.name;
            return 'Idling.';
        }
        if (host === "PPRO") {
            if (app.project && app.project.activeSequence) {
                var sequenceName = app.project.activeSequence.name;
                var itemCount = 0;
                if (app.project.rootItem && app.project.rootItem.children) itemCount = app.project.rootItem.children.numItems;
                return sequenceName + " (" + itemCount + " items)";
            }
        }
        if (host === "PHXS") return app.activeDocument.activeLayer.name;
    } catch (e) {}
    if (host === "AEFT") return 'No Composition';
    return 'Idling.';
}

function getSmallImageKey() {
    var host = getDiscordAppId();
    try {
        if (host === "AEFT") {
            var tool = app.project.toolType;
            var postImagesMap = {};
            if (typeof ToolType !== 'undefined') {
                if (ToolType.Tool_Arrow) postImagesMap[ToolType.Tool_Arrow] = "https://res.cloudinary.com/dfzaret8p/image/upload/Selection_Tool.png";
                if (ToolType.Tool_Hand) postImagesMap[ToolType.Tool_Hand] = "https://res.cloudinary.com/dfzaret8p/image/upload/Hand_Tool.png";
                if (ToolType.Tool_Magnify) postImagesMap[ToolType.Tool_Magnify] = "https://res.cloudinary.com/dfzaret8p/image/upload/Zoom_Tool.png";
                postImagesMap[9044] = "https://res.cloudinary.com/dfzaret8p/image/upload/Orbit_Around_Cursor_Tool.png";
                postImagesMap[9045] = "https://res.cloudinary.com/dfzaret8p/image/upload/Orbit_Around_Scene_Tool.png";
                postImagesMap[9015] = "https://res.cloudinary.com/dfzaret8p/image/upload/Orbit_Around_Camera_POI2.png";
                postImagesMap[9046] = "https://res.cloudinary.com/dfzaret8p/image/upload/Pan_Under_Cursor_Tool.png";
                postImagesMap[9016] = "https://res.cloudinary.com/dfzaret8p/image/upload/Pan_Camera_POI_Tool2.png";
                postImagesMap[9047] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Dolly_Towards_Cursor_Tool.png";
                postImagesMap[9048] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Dolly_To_Cursor_Tool.png";
                postImagesMap[9017] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Dolly_to_Camera_POI_Tool.png";
                if (ToolType.Tool_Rotate) postImagesMap[ToolType.Tool_Rotate] = "https://res.cloudinary.com/dfzaret8p/image/upload/Rotation_Tool.png";
                if (ToolType.Tool_PanBehind) postImagesMap[ToolType.Tool_PanBehind] = "https://res.cloudinary.com/dfzaret8p/image/upload/Pan_Behind_Anchor_Point_Tool.png";
                if (ToolType.Tool_Rect) postImagesMap[ToolType.Tool_Rect] = "https://res.cloudinary.com/dfzaret8p/image/upload/v5/Rectangle_Tool.png";
                if (ToolType.Tool_RoundedRect) postImagesMap[ToolType.Tool_RoundedRect] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Rounded_Rectangle_Tool.png";
                if (ToolType.Tool_Oval) postImagesMap[ToolType.Tool_Oval] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Ellipse_Tool.png";
                if (ToolType.Tool_Polygon) postImagesMap[ToolType.Tool_Polygon] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Polygon_Tool.png";
                if (ToolType.Tool_Star) postImagesMap[ToolType.Tool_Star] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Star_Tool.png";
                if (ToolType.Tool_Pen) postImagesMap[ToolType.Tool_Pen] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Pen_Tool.png";
                if (ToolType.Tool_PenPlus) postImagesMap[ToolType.Tool_PenPlus] = "https://res.cloudinary.com/dfzaret8p/image/upload/v3/Add_Vertex_Tool.png";
                if (ToolType.Tool_PenMinus) postImagesMap[ToolType.Tool_PenMinus] = "https://res.cloudinary.com/dfzaret8p/image/upload/v3/Delete_Vertex_Tool.png";
                if (ToolType.Tool_PenConvert) postImagesMap[ToolType.Tool_PenConvert] = "https://res.cloudinary.com/dfzaret8p/image/upload/Convert_Vertex_Tool.png";
                if (ToolType.Tool_Feather) postImagesMap[ToolType.Tool_Feather] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Mask_Feather_Tool.png";
                if (ToolType.Tool_TextH) postImagesMap[ToolType.Tool_TextH] = "https://res.cloudinary.com/dfzaret8p/image/upload/Horizontal_Type_Tool.png";
                if (ToolType.Tool_TextV) postImagesMap[ToolType.Tool_TextV] = "https://res.cloudinary.com/dfzaret8p/image/upload/Vertical_Type_Tool.png";
                if (ToolType.Tool_Paintbrush) postImagesMap[ToolType.Tool_Paintbrush] = "https://res.cloudinary.com/dfzaret8p/image/upload/Brush_Tool.png";
                if (ToolType.Tool_CloneStamp) postImagesMap[ToolType.Tool_CloneStamp] = "https://res.cloudinary.com/dfzaret8p/image/upload/Clone_Stamp_Tool.png";
                if (ToolType.Tool_Eraser) postImagesMap[ToolType.Tool_Eraser] = "https://res.cloudinary.com/dfzaret8p/image/upload/Eraser_Tool.png";
                if (ToolType.Tool_Quickselect) postImagesMap[ToolType.Tool_Quickselect] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Roto_Brush.png";
                if (ToolType.Tool_Hairbrush) postImagesMap[ToolType.Tool_Hairbrush] = "https://res.cloudinary.com/dfzaret8p/image/upload/Refine_Edge_Tool.png";
                if (ToolType.Tool_Pin) postImagesMap[ToolType.Tool_Pin] = "https://res.cloudinary.com/dfzaret8p/image/upload/Puppet_Position_Pin_Tool.png";
                if (ToolType.Tool_PinStarch) postImagesMap[ToolType.Tool_PinStarch] = "https://res.cloudinary.com/dfzaret8p/image/upload/Puppet_Starch_Pin_Tool.png";
                postImagesMap[9038] = "https://res.cloudinary.com/dfzaret8p/image/upload/Puppet_Bend_Pin_Tool.png";
                postImagesMap[9043] = "https://res.cloudinary.com/dfzaret8p/image/upload/Puppet_Advanced_Pin_Tool.png";
                if (ToolType.Tool_PinDepth) postImagesMap[ToolType.Tool_PinDepth] = "https://res.cloudinary.com/dfzaret8p/image/upload/v2/Puppet_Overlap_Pin_Tool.png";
            }
            if (postImagesMap[tool]) return postImagesMap[tool];
            return "https://res.cloudinary.com/dfzaret8p/image/upload/Unrecognized_Tool.png";
        }
        if (host === "PHXS") {
            var toolName = app.currentTool.toString().toLowerCase();
            var pm = {
                "movetool": "https://i.postimg.cc/YOUR_LINK/move.png",
                "artboardtool": "https://i.postimg.cc/YOUR_LINK/artboard.png",
                "marqueerecttool": "https://i.postimg.cc/YOUR_LINK/marquee-rect.png",
                "marqueeelliptool": "https://i.postimg.cc/YOUR_LINK/marquee-ellip.png",
                "marqueesinglerowtool": "https://i.postimg.cc/YOUR_LINK/marquee-single-row.png",
                "marqueesinglecolumntool": "https://i.postimg.cc/YOUR_LINK/marquee-single-column.png",
                "lassotool": "https://i.postimg.cc/YOUR_LINK/lasso.png",
                "polyseltool": "https://i.postimg.cc/YOUR_LINK/polygonal-lasso.png",
                "magneticlassotool": "https://i.postimg.cc/YOUR_LINK/magnetic-lasso.png",
                "quickselecttool": "https://i.postimg.cc/YOUR_LINK/quick-select.png",
                "objectselecttool": "https://i.postimg.cc/YOUR_LINK/object-select.png", 
                "magicwandtool": "https://i.postimg.cc/YOUR_LINK/magic-wand.png",
                "croptool": "https://i.postimg.cc/YOUR_LINK/crop.png",
                "perspectivecroptool": "https://i.postimg.cc/YOUR_LINK/perspective-crop.png",
                "slicetool": "https://i.postimg.cc/YOUR_LINK/slice.png",
                "sliceselecttool": "https://i.postimg.cc/YOUR_LINK/slice-select.png",
                "frametool": "https://i.postimg.cc/YOUR_LINK/frame.png", 
                "eyedroppertool": "https://i.postimg.cc/YOUR_LINK/eyedropper.png",
                "3dmaterialselecttool": "https://i.postimg.cc/YOUR_LINK/3d-material-select.png",
                "colorsamplertool": "https://i.postimg.cc/YOUR_LINK/color-sampler.png",
                "rulertool": "https://i.postimg.cc/YOUR_LINK/ruler.png",
                "textannottool": "https://i.postimg.cc/YOUR_LINK/note.png",
                "counttool": "https://i.postimg.cc/YOUR_LINK/count.png",
                "spothealingbrushtool": "https://i.postimg.cc/YOUR_LINK/spot-healing.png",
                "magicstamptool": "https://i.postimg.cc/YOUR_LINK/healing-brush.png",
                "patchselection": "https://i.postimg.cc/YOUR_LINK/patch.png",
                "recomposeselection": "https://i.postimg.cc/YOUR_LINK/content-aware-move.png",
                "redeyetool": "https://i.postimg.cc/YOUR_LINK/red-eye.png",
                "removetool": "https://i.postimg.cc/YOUR_LINK/remove.png", 
                "clonestamptool": "https://i.postimg.cc/YOUR_LINK/clone-stamp.png",
                "patternstamptool": "https://i.postimg.cc/YOUR_LINK/pattern-stamp.png",
                "paintbrushtool": "https://i.postimg.cc/YOUR_LINK/brush.png",
                "penciltool": "https://i.postimg.cc/YOUR_LINK/pencil.png",
                "colorreplacementbrushtool": "https://i.postimg.cc/YOUR_LINK/color-replacement.png",
                "wetbrushtool": "https://i.postimg.cc/YOUR_LINK/mixer-brush.png",
                "historybrushtool": "https://i.postimg.cc/YOUR_LINK/history-brush.png",
                "artbrushtool": "https://i.postimg.cc/YOUR_LINK/art-history-brush.png",
                "erasertool": "https://i.postimg.cc/YOUR_LINK/eraser.png",
                "backgrounderasertool": "https://i.postimg.cc/YOUR_LINK/background-eraser.png",
                "magicerasertool": "https://i.postimg.cc/YOUR_LINK/magic-eraser.png",
                "gradienttool": "https://i.postimg.cc/YOUR_LINK/gradient.png",
                "buckettool": "https://i.postimg.cc/YOUR_LINK/paint-bucket.png",
                "3dmaterialdroptool": "https://i.postimg.cc/YOUR_LINK/3d-material-drop.png",
                "blurtool": "https://i.postimg.cc/YOUR_LINK/blur.png",
                "sharpentool": "https://i.postimg.cc/YOUR_LINK/sharpen.png",
                "smudgetool": "https://i.postimg.cc/YOUR_LINK/smudge.png",
                "dodgetool": "https://i.postimg.cc/YOUR_LINK/dodge.png",
                "burnintool": "https://i.postimg.cc/YOUR_LINK/burn.png",
                "saturationtool": "https://i.postimg.cc/YOUR_LINK/sponge.png",
                "pentool": "https://i.postimg.cc/YOUR_LINK/pen.png",
                "freeformpentool": "https://i.postimg.cc/YOUR_LINK/freeform-pen.png",
                "curvaturepentool": "https://i.postimg.cc/YOUR_LINK/curvature-pen.png", 
                "addknottool": "https://i.postimg.cc/YOUR_LINK/add-anchor-point.png",
                "deleteknottool": "https://i.postimg.cc/YOUR_LINK/delete-anchor-point.png",
                "convertknottool": "https://i.postimg.cc/YOUR_LINK/convert-point.png",
                "pathcomponentselecttool": "https://i.postimg.cc/YOUR_LINK/path-selection.png",
                "directselecttool": "https://i.postimg.cc/YOUR_LINK/direct-selection.png",
                "typecreateoredittool": "https://i.postimg.cc/YOUR_LINK/horizontal-type.png",
                "typeverticalcreateoredittool": "https://i.postimg.cc/YOUR_LINK/vertical-type.png",
                "typecreatemasktool": "https://i.postimg.cc/YOUR_LINK/horizontal-type-mask.png",
                "typeverticalcreatemasktool": "https://i.postimg.cc/YOUR_LINK/vertical-type-mask.png",
                "rectangletool": "https://i.postimg.cc/YOUR_LINK/rectangle.png",
                "roundedrectangletool": "https://i.postimg.cc/YOUR_LINK/rounded-rectangle.png",
                "ellipsetool": "https://i.postimg.cc/YOUR_LINK/ellipse.png",
                "triangletool": "https://i.postimg.cc/YOUR_LINK/triangle.png", 
                "polygontool": "https://i.postimg.cc/YOUR_LINK/polygon.png",
                "linetool": "https://i.postimg.cc/YOUR_LINK/line.png",
                "customshapetool": "https://i.postimg.cc/YOUR_LINK/custom-shape.png",
                "handtool": "https://i.postimg.cc/YOUR_LINK/hand.png",
                "rotatetool": "https://i.postimg.cc/YOUR_LINK/rotate-view.png",
                "zoomtool": "https://i.postimg.cc/YOUR_LINK/zoom.png",
                "3dorbitcameratool": "https://i.postimg.cc/YOUR_LINK/3d-orbit.png", 
                "3dpancameratool": "https://i.postimg.cc/YOUR_LINK/3d-pan.png", 
                "3dobjectpantool": "https://i.postimg.cc/YOUR_LINK/3d-object-pan.png" 
            };
            if (pm[toolName]) return pm[toolName];
            return "https://i.postimg.cc/YOUR_LINK/default-photoshop-tool.png"; 
        }
    } catch(e) {}
    return "";
}

function getPartySize() {
    try {
        if (app.project && app.project.activeItem && app.project.activeItem instanceof CompItem) {
            return app.project.activeItem.selectedLayers.length.toString();
        }
    } catch(e) {}
    return "0";
}

function getPartyMax() {
    try {
        if (app.project && app.project.activeItem && app.project.activeItem instanceof CompItem) {
            return app.project.activeItem.numLayers.toString();
        }
    } catch(e) {}
    return "0";
}
