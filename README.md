# DJNP

Die Familien-App DJNP von Dagmar, Jürgen, Nina und Philip: Termine, Essen, Einkauf, Aufgaben mit Countdown, wer wann wo ist, Dokumente und ein privater Bereich.

- Die App ist eine Web-App: am Handy im Browser öffnen und zum Startbildschirm hinzufügen.
- Die Daten liegen in Supabase und sind durch Anmeldung und Zugriffsregeln geschützt (`datenbank/supabase-setup.sql`).
- `config.js` enthält nur den öffentlichen Schlüssel. Er gibt ohne Anmeldung keinen Zugriff auf Daten.
