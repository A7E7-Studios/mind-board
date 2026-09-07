# MindBoard 0.2.4

Paste where your mouse is pointing.

- Pasted images, notes, and plain text are centered on the mouse position over the canvas.
- When no canvas mouse position is available, paste uses the center of the current view.
- Placement accounts for pan and zoom. Pasting text keeps the view still, and moving the mouse while an image loads does not change its paste target.

## Download for Windows x64

- **MindBoard_0.2.4_x64-setup.exe**: installer, with Start menu access.
- **MindBoard_0.2.4_windows-x64-portable.zip**: extract and run `MindBoard.exe` without installation.
- **SHA256SUMS.txt**: checksums for both downloads.

Existing `.mindboard` files remain compatible. Close MindBoard normally before updating. If the installer asks to uninstall the previous version, leave **Delete application data** unchecked to preserve local board recovery.

The app requires Microsoft Edge WebView2; the installer can obtain it when needed. Downloads are not code-signed, so Windows may display its unrecognized-app prompt.

Source code and usage documentation: [A7E7-Studios/mind-board](https://github.com/A7E7-Studios/mind-board).
