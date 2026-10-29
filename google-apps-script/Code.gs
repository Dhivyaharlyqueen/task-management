function doGet(e) {
  createExtraSheets();
  var which = e && e.parameter && e.parameter.sheet;
  var rows = which === "projects" ? readProjects() : which === "users" ? readUsers() : readRows();
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
  var incoming = JSON.parse(e.postData.contents);

  if (incoming && incoming.action === "saveUsers") {
    writeSimpleSheet(directorySheet("Users", ["Employee ID", "Employee Name", "Email ID"]), ["Employee ID", "Employee Name", "Email ID"], incoming.rows || []);
    return ContentService.createTextOutput("ok");
  }

  if (incoming && incoming.action === "saveProjects") {
    writeSimpleSheet(directorySheet("Projects", ["Project Name"]), ["Project Name"], incoming.rows || []);
    return ContentService.createTextOutput("ok");
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var headers = [
    "Task ID",
    "Date",
    "Employee ID",
    "Employee Name",
    "Task Done"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    var currentHeaders = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(function (value) {
        return String(value).trim();
      });

    if (currentHeaders.indexOf("Task ID") === -1) {
      sheet.insertColumnBefore(1);
      sheet.getRange(1, 1).setValue("Task ID");
    }
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  var values = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
    : [];

  currentHeaders = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function (value) {
      return String(value).trim();
    });

  var col = {};
  currentHeaders.forEach(function (header, index) {
    col[header] = index;
  });

  var rowById = {};

  values.forEach(function (row, index) {
    var id = String(row[col["Task ID"]] || "").trim();
    if (id) rowById[id] = index + 2;
  });

  incoming.forEach(function (item) {
    var id = String(item["Task ID"] || item["Record ID"] || "").trim();

    var data = [
      id,
      item["Date"] || "",
      item["Employee ID"] || "",
      item["Employee Name"] || "",
      item["Task Done"] || ""
    ];

    var targetRow = id ? rowById[id] : null;

    if (!targetRow) {
      for (var i = 0; i < values.length; i++) {
        var oldRow = values[i];

        var oldId = String(oldRow[col["Task ID"]] || "").trim();
        var oldEmpId = String(oldRow[col["Employee ID"]] || "").trim();
        var oldName = String(oldRow[col["Employee Name"]] || "").trim();
        var oldTask = String(oldRow[col["Task Done"]] || "").trim();

        if (
          !oldId &&
          oldEmpId === String(item["Employee ID"] || "").trim() &&
          oldName === String(item["Employee Name"] || "").trim() &&
          oldTask === String(item["Task Done"] || "").trim()
        ) {
          targetRow = i + 2;
          break;
        }
      }
    }

    if (targetRow) {
      sheet.getRange(targetRow, 1, 1, 5).setValues([data]);
      rowById[id] = targetRow;
    } else {
      sheet.appendRow(data);
      if (id) rowById[id] = sheet.getLastRow();
    }
  });

  return ContentService.createTextOutput("ok");
}

function readRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var values = sheet.getDataRange().getValues();

  if (values.length < 2) return [];

  var timezone = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSpreadsheetTimeZone();

  var headers = values[0].map(function (header) {
    return String(header).trim();
  });

  return values.slice(1).map(function (row) {
    var item = {};

    headers.forEach(function (header, index) {
      if (!header) return;

      var value = row[index];

      if (header === "Date" && value instanceof Date) {
        value = Utilities.formatDate(value, timezone, "dd/MM/yyyy");
      }

      item[header] = value;
    });

    return item;
  }).filter(function (item) {
    return String(
      item["Task ID"] ||
      item["Employee ID"] ||
      item["Employee Name"] ||
      item["Task Done"] ||
      ""
    ).trim() !== "";
  });
}

function readProjects() {
  var sheet = directorySheet("Projects", ["Project Name"]);
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];

  var first = String(values[0][0] || "").trim().toLowerCase();
  var start = first === "project name" || first === "project" || first === "name" ? 1 : 0;

  return values.slice(start).map(function (row) {
    return { "Project Name": String(row[0] || "").trim() };
  }).filter(function (item) {
    return item["Project Name"] !== "";
  });
}

function readUsers() {
  var sheet = directorySheet("Users", ["Employee ID", "Employee Name", "Email ID"]);
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
    return String(item["Employee ID"] || item["Employee Name"] || item["Email ID"] || "").trim() !== "";
  });
}

function createExtraSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Open this script from the Google Sheet: Extensions, Apps Script, then run createExtraSheets again.");
  }
  styleHeader(ss.getSheets()[0], "#1d4ed8");
  styleHeader(ensureNamedSheet(ss, "Users", ["Employee ID", "Employee Name", "Email ID"]), "#047857");
  styleHeader(ensureNamedSheet(ss, "Projects", ["Project Name"]), "#6d28d9");
}

function directorySheet(name, headers) {
  var colors = { "Users": "#047857", "Projects": "#6d28d9" };
  var sheet = ensureNamedSheet(SpreadsheetApp.getActiveSpreadsheet(), name, headers);
  styleHeader(sheet, colors[name] || "#1d4ed8");
  return sheet;
}

function ensureNamedSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function styleHeader(sheet, color) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol);
  header.setBackground(color);
  header.setFontColor("#ffffff");
  header.setFontWeight("bold");
  header.setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
}

function writeSimpleSheet(sheet, headers, rows) {
  sheet.clearContents();
  sheet.appendRow(headers);
  rows.forEach(function (row) {
    sheet.appendRow(headers.map(function (header) {
      return row[header] == null ? "" : row[header];
    }));
  });
}
