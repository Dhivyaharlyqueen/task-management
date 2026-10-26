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
  var headers = ["Record ID", "Date", "Employee ID", "Employee Name", "Task Done"];
  sheet.clearContents();
  sheet.appendRow(headers);
  incoming.forEach(function (row) {
    sheet.appendRow(headers.map(function (header) {
      return row[header] == null ? "" : row[header];
    }));
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
      if (!header) return;
      var value = row[index];
      if (Object.prototype.toString.call(value) === "[object Date]") {
        value = Utilities.formatDate(value, Session.getScriptTimeZone(), "dd/MM/yyyy");
      }
      item[header] = value;
    });
    return item;
  }).filter(function (item) {
    return String(item["Record ID"] || item.Date || item["Employee ID"] || item["Employee Name"] || item["Task Done"] || "").trim() !== "";
  });
}
