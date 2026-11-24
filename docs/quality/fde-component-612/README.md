# FDE module component verification for #612

Chrome 158.0.8127.37 rendered the released ModuleWorkspace with the actual FDE manifest. The fixture used synthetic account, enrollment and progress responses and extended the first activity title to exercise long text. The CSS came from production build `444807aeb` with manifest SHA-256 `664ea14dffcb3d06542ffdd25524117b84dd4d76b41d23c559adbec9b2ce3b3c`. The existing release hold on the public route remained in effect.

All four browser contexts observed initial loading, a temporary catalog failure and recovery through Retry. The next activity was the first reading with a 25-minute estimate. The module showed 3h across five activities. All eight captures had zero horizontal overflow and visible main actions of 44–90 px. The page recorded zero uncaught exceptions and zero external requests. [Measurements](results.json).

| Theme and viewport | Normal text | 200% text |
|---|---|---|
| Light, 360 px | [Screenshot](fde-light-360-100.png) | [Screenshot](fde-light-360-200.png) |
| Dark, 360 px | [Screenshot](fde-dark-360-100.png) | [Screenshot](fde-dark-360-200.png) |
| Light, 1280 px | [Screenshot](fde-light-1280-100.png) | [Screenshot](fde-light-1280-200.png) |
| Dark, 1280 px | [Screenshot](fde-dark-1280-100.png) | [Screenshot](fde-dark-1280-200.png) |
