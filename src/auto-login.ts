const xml = (s: string) => s.replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const winQuote = (s: string) => `"${s.replace(/(\\*)"/g, '$1$1\\"')
  .replace(/(\\+)$/, "$1$1")}"`;

export function autoTask(command: string[], user: string,
  start = new Date().toISOString()) {
  const args = command.slice(1).map(winQuote).join(" ");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers>
<TimeTrigger><Enabled>true</Enabled>
<StartBoundary>${xml(start)}</StartBoundary>
<Repetition><Interval>PT1M</Interval></Repetition></TimeTrigger>
<LogonTrigger><Enabled>true</Enabled><UserId>${xml(user)}</UserId></LogonTrigger>
</Triggers>
<Principals><Principal id="User"><UserId>${xml(user)}</UserId>
<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>
</Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
<StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled>
<Hidden>true</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
<Actions Context="User"><Exec><Command>${xml(command[0]!)}</Command>
<Arguments>${xml(args)}</Arguments></Exec></Actions></Task>`;
}

export function autoDesktop(script: string) {
  const arg = script.replace(/[\\\x22`$]/g, value => `\\${value}`)
    .replaceAll("\\", "\\\\").replaceAll("%", "%%")
    .replaceAll("\n", "\\n").replaceAll("\r", "\\r");
  return `[Desktop Entry]
Type=Application
Name=Luon updates
Exec=/bin/sh "${arg}"
Terminal=false
NoDisplay=true
`;
}
