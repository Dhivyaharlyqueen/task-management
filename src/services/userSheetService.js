const APPS_SCRIPT_URL = "YOUR_DEPLOYED_APPS_SCRIPT_WEB_APP_URL";

export async function saveUserToSheet(user) {
  const payload = {
    action: "saveUser",
    employeeId: user.employeeId,
    employeeName: user.employeeName,
    email: user.email,
  };

  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
}
