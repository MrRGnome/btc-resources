var TemplateEngine = {};
TemplateEngine.settings = {};

//Set this to wherever your html templates are that will be loaded relative to your root directory, include a leading slash and no trailing slash. Leave empty if loading from root directory.
TemplateEngine.settings.VIEWS_FOLDER = "/views";

//The full URL representing the hosted root directory - required to prevent queries to other sites in production or explicitly define a URL path
//TemplateEngine.settings.DOMAIN = "https://mrrgnome.github.io/btc-resources";
//TemplateEngine.settings.DOMAIN = "http://127.0.0.1:5500";

//Set this to a css class name which includes the property "display: hidden;"
TemplateEngine.settings.HIDDEN_CLASS = "hidden";

//Auto parse document
TemplateEngine.settings.AUTOLOAD = true;

//Should document be hidden until some future parsed point?
TemplateEngine.settings.HIDE_TEMPLATE = true;

//Enable one-way binding where changes to the javascript variable are reflected to the HTML template (Alpha feature, may experience bugs. Disabled by default)
TemplateEngine.settings.BINDING = false;

//Enable debug output to js console (WARNGING - TRUE MAY CAUSE PERFOMANCE SLOW DOWN FOR LARGE LOADS)
TemplateEngine.settings.DEBUG = false;

//Enable ANTI_XHR_CACHING to store retrieved templates in sessionStorage - increases performance on documents with multiple requests to the same template
TemplateEngine.settings.ANTI_XHR_CACHING = false;

TemplateEngine.activeRequests = {};

TemplateEngine.callbackReference = {};
TemplateEngine.callbackStack = {};

//Template Engine start point
TemplateEngine.Start = function (e, force) {
    if (TemplateEngine.settings.AUTOLOAD || force) {
        $(document.getElementsByTagName("title")[0]).html(TemplateEngine.ParseAndReplace($(document.getElementsByTagName("title")[0]).html()));
        $(document.getElementsByTagName("body")[0]).html(TemplateEngine.ParseAndReplace($(document.getElementsByTagName("body")[0]).html()));
        var metas = document.getElementsByTagName("meta");
        for (var i in metas) {
            if (typeof metas[i].hasAttribute === "function" && metas[i].hasAttribute("content")) {
                var content = $(metas[i]).attr("content");
                if (content)
                    $(metas[i]).attr("content", TemplateEngine.ParseAndReplace(content));
            }
        }
    }
};

document.addEventListener('DOMContentLoaded', TemplateEngine.Start, false);

//ParseAndReplace executes a regex search for curly braces in the provided html text and parses their inner content, looking for variable names, template load requests, and repeating logic
//Accepted html syntax are:
//{{variableName}} - outputs variable content
//{{scope.variableName}} - outputs variable content
//{{variableName.json}} - outputs variable as stringified json
//{{variableName.todate}} - outputs variable as ISO datetime
//{{variableName.local}} - outputs variable as local machine datetime
//{{this}} - outputs the local scope, useful in templates called with "foreach"
//{{loadtemplate template.html at htmlElementId}} - loads an html document and insert it into htmlElementId
//{{loadtemplate template.html at htmlElementId with variableName}} - loads an html document and inserts it into htlmElementId using variableName to populate the template
//{{foreach iterableVariable loadtemplate template.html at htmlElementId}} - loads a template and iterates over an object or array. The template is loaded as many times as the iterableVariable is iterable, with theiterableVariable being passed as the local context for another round of ParsAndReplace on the loaded template.

//ParseAndreplace also accepts a replaceMatrix which can be used to define for more sohpisticated templating needs. In the example below the html {{email_subscription}} is replaced by the word "CHECKED" which checks a checkbox if the user is subscribed to email newsletters.
// $("#userProfileBody").html(ParseAndReplace("<input type='checkbox' {{email_subscription}}>", {
//"{{email_subscrption}}": user.preferences.email_subscription ? "CHECKED" : ""
//}));

TemplateEngine.ParseAndReplace = function (html, replaceMatrix, localScope, fullScope, cb, hashCode) {
    if (!fullScope)
        fullScope = "";

    if (!localScope)
        localScope = window;

    //setup callback tracker so I know when we're done
    if (!hashCode) {
        hashCode = TemplateEngine.HashCode(html);
        if (TemplateEngine.callbackReference[hashCode])
            TemplateEngine.callbackReference[hashCode]++;
        else
            TemplateEngine.callbackReference[hashCode] = 1;

        if (TemplateEngine.callbackStack[hashCode] && cb)
            TemplateEngine.callbackStack[hashCode].push(cb);
        else if (!TemplateEngine.callbackStack[hashCode])
            TemplateEngine.callbackStack[hashCode] = cb ? [cb] : [];
    }
    else
        TemplateEngine.callbackReference[hashCode]++;

    if (replaceMatrix) {
        for (var key in replaceMatrix) {
            var re = new RegExp(key, "g");
            html = html.replace(re, replaceMatrix[key]);
            if (TemplateEngine.settings.DEBUG) console.log(key + " = " + replaceMatrix[key]);
        }
    }

    //Find and replace bound variables (must be done before other variable replacement as there is an overlap in regex values)
    var findTwoWayBinds = TemplateEngine.settings.BINDING ? /(<input[^>]*?{{\s*?([^\s]+?)\s*?}}[^>]*?>)/gi : /(<input[^>]*?{{\s*?[^\s]+?\.bind(\s|\.|$)*?}}[^>]*?>)/gi;
    html = html.replace(findTwoWayBinds, TemplateEngine.TwoWayBinding.bind({replaceMatrix: replaceMatrix, localScope: localScope, fullScope: fullScope, cb: cb, hashCode: hashCode}));

    //find and replace variable names
    html = html.replace(/{{\s*?([^\s]+?)\s*?}}/g, TemplateEngine.ReplaceStrWithObjVal.bind({localScope: localScope, fullScope: fullScope}));
    

    //find foreach
    html = html.replace(/{{\s*?(foreach[^}]+?)}}/g, TemplateEngine.Foreach.bind({ localScope: localScope, hashCode: hashCode }));

    //find loadtemplate
    html = html.replace(/{{\s*?(loadtemplate[^}]+?)}}/g, TemplateEngine.LoadTemplateParse.bind({ localScope: localScope, hashCode: hashCode }));

    TemplateEngine.AttemptCallback(hashCode, true);

    return html;
};


//Load template creates a request to load additional content, stores it to session storage if a load is successful, and calls the call back.
TemplateEngine.LoadTemplate = function (filename, callback, divId) {
    var fileDir = "";
    if (!filename.match(/http.*:\/\//)) {
        fileDir = TemplateEngine.settings.VIEWS_FOLDER + "/";
    }

    if (TemplateEngine.settings.ANTI_XHR_CACHING) {
        if (sessionStorage[filename]) {
            callback(sessionStorage[filename], divId);
            return;
        }

        if (TemplateEngine.activeRequests[filename]) {
            TemplateEngine.activeRequests[filename].push({ callback: callback, divId: divId });
            return;
        }

        TemplateEngine.activeRequests[filename] = [];
    }

    var domain = window.location.protocol + "//" + window.location.host;

    if (TemplateEngine.settings.DOMAIN && domain == TemplateEngine.settings.DOMAIN.substring(0,domain.length -1))
        fileDir = TemplateEngine.settings.DOMAIN + fileDir;

    var r = new XMLHttpRequest();
    r.open("GET", fileDir + filename, true);
    r.onreadystatechange = function () {
        if (r.readyState != 4 || r.status != 200)
            return;
        if (TemplateEngine.settings.ANTI_XHR_CACHING) {
            sessionStorage[filename] = r.responseText;
            for (var i in TemplateEngine.activeRequests[filename])
                TemplateEngine.activeRequests[filename][i].callback(r.responseText, TemplateEngine.activeRequests[filename][i].divId);
            TemplateEngine.activeRequests[filename] = null;
        }

        callback(r.responseText, divId);
    };
    r.send(null);
};

//GetObjectFromString attempts to search through the scope provided for a defined variable in the typical javascript format, for example "TemplateEngine.settings.DEBUG"
//Accepts keywords such as "this", ".json" (which provides the JSON.stringify-ied version of the variable), ".todate" (Converts variable to ISO date), ".local" (Converts to local machine date and time)
TemplateEngine.GetObjFromString = function (objectPath, localScope, getLocalScope) {

    if (localScope == undefined)
        localScope = window;

    //Do all pre-object serach template parsing

    //Remove binding - todo stop truncating of var names with keywords in them
    objectPath = objectPath.replace(/(\.bind)(\s|\.|$)+/g, "$2");
    objectPath = objectPath.replace(/(\.unbind)(\s|\.|$)+/g, "$2");

    var json = false;
    if (objectPath.match(/\.json/)) {
        json = true;
        objectPath = objectPath.replace(/(\.json)(\s|\.|$)+/g, "$2");
    }

    //I don't need this.
    if (objectPath.match("this")) {
        objectPath = objectPath.replace(/(\s|^)+(this\.)/g, "$1");
        if (objectPath == "this")
            return localScope;
    }


    var todate = false;
    var local = false;
    if (objectPath.match(/(\.todate)(\s|\.|$)+/)) {
        todate = true;
        objectPath = objectPath.replace(/(\.todate)(\s|\.|$)+/g, "$2");

        if (objectPath.match(/\.local/)) {
            local = true;
            objectPath = objectPath.replace(/(\.local)(\s|\.|$)+/g, "$2");
        }
    }

    var replaceWhite = false;
    var replaceWith = "";
    if (objectPath.match(/\.replace-whitespace\./)) {
        replaceWhite = true;
        var re = new RegExp("(?:\.replace-whitespace\.)(.[^.\n]*)", "g");
        replaceWith = re.exec(objectPath)[1];
        objectPath = objectPath.replace(/\.replace-whitespace\..[^.\n]*/g, "");
    }


    //Avoid digging through path if already parsed down
    objectPath = objectPath.split(".");
    if (getLocalScope) {
        if (objectPath.length == 1)
            return localScope;
    }

    //Start object search
    var foundVariable;
    var n = 0;
    var tmp = localScope;
    if (objectPath.length == 0)
        foundVariable = localScope;
    else
        while (!foundVariable && tmp != undefined) {
            tmp = tmp[objectPath[n]];

            if (n == objectPath.length - 1) {
                foundVariable = tmp;
                break;
            }

            if ((getLocalScope && n == objectPath.length - 2))
                return tmp;
            n++;
        }

    //Apply object templating and return values
    if (foundVariable == undefined || foundVariable == "NaN")
        foundVariable = "";

    if (todate && foundVariable != "") {

        var date;
        if (local) {
            date = new Date(foundVariable);
            foundVariable = date.toLocaleString();
        }

        else {
            date = new Date(parseInt(foundVariable));
            foundVariable = date.toISOString().substr(0, 10);
        }

    }

    if (replaceWhite) {
        var re = new RegExp(" ", "g");
        foundVariable = foundVariable.replace(re, replaceWith);
    }


    if (json)
        foundVariable = JSON.stringify(foundVariable);

    return foundVariable;
};

TemplateEngine.ReplaceStrWithObjVal = function (match, objectPath) {

    //Do all pre-object serach template parsing

    //Remove binding
    var binding = TemplateEngine.settings.BINDING;
    if (objectPath.match(/(\.bind)(\s|\.|$)+/)) {
        binding = true;
        objectPath = objectPath.replace(/(\.bind)(\s|\.|$)+?/, "$2");
    }
    else if (objectPath.match(/(\.unbind)(\s|\.|$)+/)) {
        binding = false;
        objectPath = objectPath.replace(/(\.unbind)(\s|\.|$)+?/, "$2");
    }

    var unbound_objectPath = objectPath;

    var json = false;
    if (objectPath.match(/\.json/)) {
        json = true;
        objectPath = objectPath.replace(/(\.json)(\s|\.|$)+?/g, "$2");
    }

    //I don't need this.
    if (objectPath.match("this")) {
        objectPath = objectPath.replace(/(\s|^)+(this\.)/g, "$1");
        if (objectPath == "this")
            return this.localScope;
    }

    var todate = false;
    var local = false;
    if (objectPath.match(/(\.todate)(\s|\.|$)+/)) {
        todate = true;
        objectPath = objectPath.replace(/(\.todate)(\s|\.|$)+?/g, "$2");

        if (objectPath.match(/\.local/)) {
            local = true;
            objectPath = objectPath.replace(/(\.local)(\s|\.|$)+?/g, "$2");
        }
    }

    var replaceWhite = false;
    var replaceWith = "";
    if (objectPath.match(/\.replace-whitespace\./)) {
        replaceWhite = true;
        var re = new RegExp("(?:\.replace-whitespace\.)(.[^.\n]*?)", "g");
        replaceWith = re.exec(objectPath)[1];
        objectPath = objectPath.replace(/\.replace-whitespace\..[^.\n]*/g, "");
    }

    objectPath = objectPath.split(".");

    //Start object search
    var foundVariable;
    var tmp = this.localScope;
    if (objectPath.length == 0)
        foundVariable = this.localScope;
    else
        for(var n = 0, l = objectPath.length; n < l; n++)
        {
            tmp = tmp[objectPath[n]];
            if (tmp == undefined || tmp == "NaN")
                return "";
        }
    foundVariable = tmp;

    //Apply object templating and return values
    if (todate) {
        var date;
        if (local) {
            date = new Date(foundVariable);
            foundVariable = date.toLocaleString();
        }
        else {
            date = new Date(parseInt(foundVariable));
            foundVariable = date.toISOString().substr(0, 10);
        }
    }

    if (replaceWhite) {
        var re = new RegExp(" ", "g");
        foundVariable = foundVariable.replace(re, replaceWith);
    }

    if (json)
        foundVariable = JSON.stringify(foundVariable);

    if (binding)
        foundVariable = TemplateEngine.OneWayBinding(unbound_objectPath, this.localScope, this.fullScope, foundVariable);

    return foundVariable;
};

TemplateEngine.OneWayBinding = function (objectPath, localScope, fullScope, variableValue) {
    //add one way binding hooks
    var parentScope = TemplateEngine.GetObjFromString(objectPath, localScope, true);
    var lastTerm = TemplateEngine.GetLastPathTerm(objectPath, localScope);

    if (parentScope && lastTerm) {

        variableValue = "<span class='binding_hook_" + fullScope + objectPath + "'>" + variableValue + "</span>";
        var setFunc = function (val) {
            if (TemplateEngine.settings.DEBUG) console.log("Searching for one way binding hook: binding_hook_" + this.fullScope + this.objectPath);
            parentScope[lastTerm] = val;
            var elements = document.getElementsByClassName("binding_hook_" + this.fullScope + this.objectPath);
            for (var index = 0; index < elements.length; index++) {
                elements[index].innerHTML = TemplateEngine.ReplaceStrWithObjVal.bind({localScope: this.localScope, fullScope: this.fullScope})(null, this.objectPath);
            }
        };

        if (TemplateEngine.settings.DEBUG) console.log("Setting up one way binding hook on: " + fullScope + objectPath);

        var boundSetFunc = setFunc.bind({ objectPath: objectPath, parentScope: parentScope, lastTerm: lastTerm, fullScope: fullScope, localScope: localScope });

        parentScope.__defineSetter__("_" + lastTerm, boundSetFunc);


    }
    else
        if (TemplateEngine.settings.DEBUG) console.log("Unable to perform one way binding on " + fullScope + objectPath + ", variable undefined");

    return variableValue;
};

TemplateEngine.TwoWayBinding = function (match, matchContents) {

    //Get ID and value
    var inputIdArr = match.match(/(?:id=)(?:"|'|&quot;|&#34;|&#39;)((?:(?!"|'|&quot;|&#34;|&#39;).)*)(?:"|'|&quot;|&#34;|&#39;)/i);
    if (!inputIdArr) {
        if (TemplateEngine.settings.DEBUG) console.log("No ID found on input which includes bindings, please make sure your inputs have an ID attribute.");
        return;
    }
    var inputId = inputIdArr[1];

    var inputValArr = match.match(/(?:value=)(?:"|'|&quot;|&#34;|&#39;)((?:(?!"|'|&quot;|&#34;|&#39;).)*)(?:"|'|&quot;|&#34;|&#39;)/i);


    var inputTypeArr = match.match(/(?:type=)(?:"|'|&quot;|&#34;|&#39;)((?:(?!"|'|&quot;|&#34;|&#39;).)*)(?:"|'|&quot;|&#34;|&#39;)/i);
    var inputType = inputTypeArr ? inputTypeArr[1] : null;

    //let last item in list be value equivilant based on type
    var attributeList = [];
    if (inputValArr) {
        attributeList.push({ attribute: "value", inputVal: inputValArr[1], unbound: inputValArr[1].replace(/(\.(?:un)*?bind)/, "") });
    }
    if (inputType && inputType.match(/radio|checkbox/g)) {
        var checkedVal = match.match(/(?:checked=)(?:"|'|&quot;|&#34;|&#39;)((?:(?!"|'|&quot;|&#34;|&#39;).)*)(?:"|'|&quot;|&#34;|&#39;)/i);
        if (checkedVal)
            attributeList.push({ attribute: "checked", inputVal: checkedVal[1], unbound: checkedVal[1].replace(/(\.(?:un)*?bind)/, "") });
    }


    //Parse Id
    var parsedId = TemplateEngine.ParseAndReplace(inputId, this.replaceMatrix, this.localScope, this.fullScope, this.cb, this.hashCode);

    var templateInputRe = new RegExp("(id=)(" + '"' + "|'|&quot;|&#34;|&#39;)(" + inputId + ")(" + '"' + "|'|&quot;|&#34;|&#39;)", "gi")
    var templatedInput = match.replace(templateInputRe, "$1$2" + parsedId + "$4");



    for (var x = 0, l = attributeList.length; x < l; x++) {
        //Parse value
        attributeList[x].parsedVal = TemplateEngine.ParseAndReplace(attributeList[x].unbound, this.replaceMatrix, this.localScope, this.fullScope, this.cb, this.hashCode);

        //Get two way bind variables
        var foundTemplates = /(?:{{\s*?)([^\s]+?)(?:\s*?}})/g.exec(attributeList[x].unbound);
        for (var n = 1, fl = foundTemplates.length; n < fl; n++) {
            var namesArr = foundTemplates[n];
            //Create binding target
            var parentScope = TemplateEngine.GetObjFromString(namesArr, this.localScope, true);
            var lastTerm = TemplateEngine.GetLastPathTerm(namesArr, this.localScope);

            if (parentScope && lastTerm) {


                var setFunc = function (val) {
                    if (TemplateEngine.settings.DEBUG) console.log("Searching for two way binding hook: " + this.parsedId + " " + this.fullScope + this.prop);

                    this.parentScope[this.lastTerm] = val;
                    var fullScopeTrunc = this.fullScope.slice(0, this.fullScope.length - 1);
                    var fullScopeObj = TemplateEngine.ReplaceStrWithObjVal.bind({ localScope: window, fullScope: this.fullScope })(null, fullScopeTrunc);
                    var newVal = TemplateEngine.ParseAndReplace(this.inputVal, this.replaceMatrix, fullScopeObj == "" ? window : fullScopeObj);

                    if (typeof val == "boolean")
                        newVal = (newVal == "true");

                    $("#" + this.parsedId).prop(this.attribute, newVal);
                };

                if (TemplateEngine.settings.DEBUG) console.log("Setting up two way binding hook on input " + parsedId + ": " + this.fullScope + namesArr);

                var boundSetFunc = setFunc.bind({ prop: namesArr, parentScope: parentScope, lastTerm: lastTerm, fullScope: this.fullScope, parsedId: parsedId, attribute: attributeList[x].attribute, inputVal: attributeList[x].unbound, replaceMatrix: this.replaceMatrix });

                //BIND _variable -> variable, _variable -> input
                parentScope.__defineSetter__("_" + lastTerm, boundSetFunc);

                //replace two way bound template in html so it isn't one way bound later
                templateInputRe = new RegExp("(" + attributeList[x].attribute + "=)(" + '"' + "|'|&quot;|&#34;|&#39;)(" + attributeList[x].inputVal + ")(" + '"' + "|'|&quot;|&#34;|&#39;)", "gi");
                templatedInput = templatedInput.replace(templateInputRe, "$1$2" + attributeList[x].parsedVal + "$4");

            }
            else
                if (TemplateEngine.settings.DEBUG) console.log("Unable to perform two way binding on " + namesArr + ", variable undefined");
        }

    }

    //BIND input -> _variable - Set the .change event through JSONP because our ID isn't written necessarily yet
    templatedInput += '<script>' +
                '$("#' + parsedId + '").change(function() {' +
                this.fullScope + "_" + lastTerm + "=" + '$("#' + parsedId + '").prop("' + attributeList[attributeList.length - 1].attribute + '");' +
                '});' +
            '</script>';

    //Final replace
    if (TemplateEngine.settings.DEBUG) console.log("Two way binding initialized output: " + templatedInput);
    return templatedInput;
};

TemplateEngine.Foreach = function (match, matchContents) {
    if (TemplateEngine.settings.DEBUG) console.log("Executing: " + match );

    //Trim tags
    var matchArr = matchContents.split(" ");

    //Get foreach object
    var foreachArr = TemplateEngine.GetObjFromString(matchArr[1], this.localScope);
    if (TemplateEngine.settings.DEBUG) console.log(matchArr[1] + " length: " + foreachArr.length);

    //look for keywords
    var loadtemplate = matchArr.indexOf("loadtemplate");
    var preDivIndex = matchArr.indexOf("at");
    var preLocalScope = matchArr.indexOf("with");
    var preCallback = matchArr.indexOf("callback");
    var instanceCallback = preCallback != -1 ? TemplateEngine.GetObjFromString(matchArr[preCallback + 1], this.localScope) : null;
    var divId = matchArr[preDivIndex + 1];
    var scopeVariable = preLocalScope != -1 ? TemplateEngine.GetObjFromString(matchArr[preLocalScope + 1], this.localScope) : null;

    if (loadtemplate != -1 && preDivIndex != -1) {
        var templateName = matchArr[loadtemplate + 1];
        //Do template binding
        var callback = function (ret, divId) {

            if (this.instanceCallback) {
                var bicb = this.instanceCallback.bind({ ret: ret, divId: divId, arrPath: this.arrPath, foreachArr: this.foreachArr, scopeVariable: this.scopeVariable, hash: this.hash });
                TemplateEngine.callbackStack[this.hash].unshift(bicb);
            }

            var finalcb = function () {
                //foreach through template
                for (var x = 0, l = this.foreachArr.length; x < l; x++) {
                    var scope = this.scopeVariable ? this.scopeVariable : this.foreachArr[x];
                    $(document.getElementById(this.divId)).append(TemplateEngine.ParseAndReplace(this.ret, {}, scope, this.arrPath + "[" + x + "]."));
                }
                $(document.getElementById(this.divId)).removeClass(TemplateEngine.settings.HIDDEN_CLASS);
            }

            var bfinalcb = finalcb.bind({ ret: ret, divId: divId, arrPath: this.arrPath, foreachArr: this.foreachArr, scopeVariable: this.scopeVariable, hash: this.hash });
            TemplateEngine.callbackStack[this.hash].unshift(bfinalcb);

            TemplateEngine.AttemptCallback(this.hash);
            return true;
        };

        var boundCallback = callback.bind({ arrPath: matchArr[1], foreachArr: foreachArr, scopeVariable: scopeVariable, hash: this.hashCode, instanceCallback: instanceCallback });


        //Add callback reference so we know when everyone is done working
        TemplateEngine.callbackReference[this.hashCode]++;

        //load template
        TemplateEngine.LoadTemplate(matchArr[loadtemplate + 1], boundCallback, divId);

    }
    else
        if (TemplateEngine.settings.DEBUG) console.log("Foreach failed due to no loadtemplate command or no divId");

    return "";

};

TemplateEngine.LoadTemplateParse = function (match, matchContent) {
    if (TemplateEngine.settings.DEBUG) console.log("Executing template " + match);

    var matchArr = matchContent.split(" ");
    var templateName = matchArr[1];
    var preDivIndex = matchArr.indexOf("at");
    var divId = matchArr[preDivIndex + 1];
    var withIndex = matchArr.indexOf("with");
    var varName = matchArr[withIndex + 1];
    var preCallback = matchArr.indexOf("callback");
    var instanceCallback = preCallback != -1 ? TemplateEngine.GetObjFromString(matchArr[preCallback + 1], this.localScope) : null;

    if (preDivIndex == -1) {
        if (TemplateEngine.settings.DEBUG) console.log("unable to load without 'at' keyword. Include 'at div_id' in your code referencing the location you wish to populate with a template on statement: " + match);
        return;
    }

    if (!templateName) {
        if (TemplateEngine.settings.DEBUG) console.log("Could not retrieve template name from: " + match);
        return;
    }

    var scopeVariable = this.localScope ? TemplateEngine.GetObjFromString(varName, this.localScope) : TemplateEngine.GetObjFromString(varName);

    var callback = function (ret, divId) {
        if(!TemplateEngine.callbackStack[this.hash])
            TemplateEngine.callbackStack[this.hash] = [];

        if(!TemplateEngine.callbackReference[this.hash])
            TemplateEngine.callbackReference[this.hash] = 1;
        else
            TemplateEngine.callbackReference[this.hash]++;
        

        var finalcb = function () {
            if (TemplateEngine.settings.DEBUG) console.log("Executing template callback " + this.divId);
            $(document.getElementById(this.divId)).html(TemplateEngine.ParseAndReplace(this.ret, {}, this.scopeVariable)); //document.getElementById(divId).innerHTML = TemplateEngine.ParseAndReplace(ret, {}, scopeVariable);
            $(document.getElementById(this.divId)).removeClass(TemplateEngine.settings.HIDDEN_CLASS);
        }

        if (this.instanceCallback) {
            var bicb = this.instanceCallback.bind({ ret: ret, divId: divId, scopeVariable: this.scopeVariable, hash: this.hash });
            TemplateEngine.callbackStack[this.hash].unshift(bicb);
        }

        var bfinalcb = finalcb.bind({ ret: ret, divId: divId, scopeVariable: this.scopeVariable, hash: this.hash });

        TemplateEngine.callbackStack[this.hash].unshift(bfinalcb);

        TemplateEngine.AttemptCallback(this.hash);
    };

    var boundCallback = callback.bind({ hash: this.hashCode, scopeVariable: scopeVariable, instanceCallback: instanceCallback });
    //Add callback reference so we know when everyone is done working
    TemplateEngine.callbackReference[this.hashCode]++;

    TemplateEngine.LoadTemplate(templateName, boundCallback, divId);

    return "";
};

//ClearBraceTags is a function designed to remove curly braces from the outside of a string so the contents may be cleanly parsed
TemplateEngine.ClearBraceTags = function (arr) {

    arr = arr.toString().replace(/{{\s*/g, "");
    arr = arr.replace(/\s*}}/g, "");
    return arr.split(" ");
};

//Used for getting the last term of a path for binding purposes
TemplateEngine.GetLastPathTerm = function (objectPath, localScope) {
    objectPath = objectPath.split(".");
    var suffixs = { "this": true, "json": true, "todate": true, "local": true, "unbind": true, "bind": true, "replace-whitespace": true };
    while (suffixs[objectPath[objectPath.length - 1]])
        objectPath = objectPath.slice(0, objectPath.length - 1);
    if (objectPath.length == 0)
        return localScope;
    else
        return objectPath[objectPath.length - 1];

};

TemplateEngine.HashCode = function (str) {
    var hash = 0;
    if (str === undefined || str.length === 0)
        return hash;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
};

TemplateEngine.AttemptCallback = function (hash, timeout) {
    if (TemplateEngine.callbackReference[hash] && TemplateEngine.callbackReference[hash] <= 1 && TemplateEngine.callbackStack[hash]) {
        TemplateEngine.callbackReference[hash] = null;
        if (timeout) {
            setTimeout(function () {
                for (var i in TemplateEngine.callbackStack[hash])
                    TemplateEngine.callbackStack[hash][i]();
            }, 0);
            return;
        }
        for (var i in TemplateEngine.callbackStack[hash])
            TemplateEngine.callbackStack[hash][i]();
    }
    else if (TemplateEngine.callbackReference[hash])
        TemplateEngine.callbackReference[hash]--;
};

if (this.module)
    module.export = TemplateEngine;