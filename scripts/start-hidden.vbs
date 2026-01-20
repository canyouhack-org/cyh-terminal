' =====================================================
' CYH Terminal - Windows Hidden Launcher
' Runs the terminal server without showing a console window
' =====================================================

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Get script directory
ScriptPath = WScript.ScriptFullName
ScriptDir = FSO.GetParentFolderName(ScriptPath)
ProjectDir = FSO.GetParentFolderName(ScriptDir)
BackendDir = ProjectDir & "\backend"
ServerExe = BackendDir & "\terminal-server.exe"
LogFile = ScriptDir & "\cyh-terminal.log"

' Check if server exists
If Not FSO.FileExists(ServerExe) Then
    MsgBox "terminal-server.exe not found!" & vbCrLf & _
           "Please run install.ps1 first.", vbCritical, "CYH Terminal"
    WScript.Quit 1
End If

' Run server hidden (0 = hidden window)
WshShell.CurrentDirectory = BackendDir
WshShell.Run """" & ServerExe & """ > """ & LogFile & """ 2>&1", 0, False

' Optional: Show notification
' MsgBox "CYH Terminal started!" & vbCrLf & "Open: http://localhost:3333", vbInformation, "CYH Terminal"

WScript.Quit 0
