/**************************************************************************************************
* ADOBE SYSTEMS INCORPORATED
* Copyright 2013 Adobe Systems Incorporated
* All Rights Reserved.
**************************************************************************************************/

function CSInterface() {
    this.PROTOCOL_VERSION = "11.0.0";
}

CSInterface.prototype.getHostEnvironment = function() {
    if (typeof window.__adobe_cep__ !== "undefined") {
        return JSON.parse(window.__adobe_cep__.getHostEnvironment());
    }
    return null;
};

CSInterface.prototype.closeExtension = function() {
    if (typeof window.__adobe_cep__ !== "undefined") {
        window.__adobe_cep__.closeExtension();
    }
};

CSInterface.prototype.getSystemPath = function(pathType) {
    if (typeof window.__adobe_cep__ !== "undefined") {
        return window.__adobe_cep__.getSystemPath(pathType);
    }
    return null;
};

CSInterface.prototype.evalScript = function(script, callback) {
    if (typeof callback === "undefined") {
        callback = function(result) {};
    }
    if (typeof window.__adobe_cep__ !== "undefined") {
        window.__adobe_cep__.evalScript(script, callback);
    }
};

CSInterface.prototype.getApplicationID = function() {
    var appId = "";
    if (typeof window.__adobe_cep__ !== "undefined") {
        var appInfo = JSON.parse(window.__adobe_cep__.getHostEnvironment());
        appId = appInfo.appId;
    }
    return appId;
};

CSInterface.prototype.addEventListener = function(type, listener, obj) {
    if (typeof window.__adobe_cep__ !== "undefined") {
        window.__adobe_cep__.addEventListener(type, listener, obj);
    }
};

CSInterface.prototype.removeEventListener = function(type, listener, obj) {
    if (typeof window.__adobe_cep__ !== "undefined") {
        window.__adobe_cep__.removeEventListener(type, listener, obj);
    }
};

CSInterface.prototype.dispatchEvent = function(event) {
    if (typeof window.__adobe_cep__ !== "undefined") {
        window.__adobe_cep__.dispatchEvent(event);
    }
};

CSInterface.prototype.getCurrentApiVersion = function() {
    if (typeof window.__adobe_cep__ !== "undefined") {
        var apiVersion = JSON.parse(window.__adobe_cep__.getCurrentApiVersion());
        return apiVersion;
    }
    return null;
};

var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
};

var CSEvent = function(type, scope, appId, extensionId) {
    this.type = type;
    this.scope = scope;
    this.appId = appId;
    this.extensionId = extensionId;
    this.data = "";
};