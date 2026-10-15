Option Explicit
Dim shell, files, folder, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & folder & "\Launch.ps1"""
result = shell.Run(command, 0, True)
If result <> 0 Then MsgBox "The application could not start. Open Launch.ps1 in PowerShell to see the error.", 16, "Independent Books"
