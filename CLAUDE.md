# DriveLive – arbetsregler för Claude

- Svara på svenska.
- Fleruppgiftsarbete följer skillen `.claude/skills/delegate`: planera, delegera till billigaste kapabla agent (`scout` = Haiku, läsning; `worker` = Sonnet, avgränsade ändringar), behåll regeltolkning (TR/FEI), resultatmotor, datamodell, säkerhetsregler och offlinelogik på huvudmodellen, och verifiera alltid själv (diff + hela testsviten) innan commit.
- Committa lokalt; deploya och pusha bara när användaren ber om det. Använd `npm run deploy`. Om firebase-steget kräver `--force` (en funktions retry-inställning har ändrats) – fråga innan `firebase deploy … --force`.
- Använd aldrig produktion för tester; emulatorerna körs med projekt `demo-combined-driving`. Stoppa inte processer du inte startat.
- Ägarens checklista för konsolen: `docs/OPS.md`.
