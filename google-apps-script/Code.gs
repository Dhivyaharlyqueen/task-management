function doGet(e) {
  var rows = readRows();
  var callback = e && e.parameter && e.parameter.callback;
  if (callback && /^[A-Za-z_][A-Za-z0-9_]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(rows) + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(JSON.stringify(rows))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var incoming = JSON.parse(e.postData.contents);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Employee ID", "Employee Name", "Task Done"]);
  }
  var existing = {};
  readRows().forEach(function (row) {
    existing[taskKey(row)] = true;
  });
  incoming.forEach(function (row) {
    var key = taskKey(row);
    if (existing[key]) return;
    existing[key] = true;
    sheet.appendRow([row["Employee ID"], row["Employee Name"], row["Task Done"]]);
  });
  return ContentService.createTextOutput("ok");
}

function readRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (header) {
    return String(header).trim();
  });
  return values.slice(1).map(function (row) {
    var item = {};
    headers.forEach(function (header, index) {
      if (header) item[header] = row[index];
    });
    return item;
  }).filter(function (item) {
    return String(item["Employee ID"] || item["Employee Name"] || item["Task Done"] || "").trim() !== "";
  });
}

function taskKey(row) {
  return ["Employee ID", "Employee Name", "Task Done"].map(function (field) {
    return String(row[field] == null ? "" : row[field]).trim();
  }).join("|");
}
