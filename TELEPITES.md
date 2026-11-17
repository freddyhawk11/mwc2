# Ki jön ma? – telepítés Render + Turso alapon

Az alkalmazás a Renderen fut (ingyenes web service), az adatokat a Turso felhős adatbázisa tárolja, így semmi nem vész el, ha a Render újraindítja vagy elaltatja a szolgáltatást. Egy ingyenes időzítő (cron-job.org) 10 percenként felkelti, így a 17:00-s értesítés mindig pontosan kimegy.

Szükséges: egy GitHub-fiók, amelyben ott van ez a kód (privát tároló is jó).

## 1. Turso adatbázis (kb. 5 perc)

1. Regisztrálj: https://turso.tech (a „Sign up with GitHub” a legegyszerűbb).
2. Hozz létre egy adatbázist: **Create Database**, név: `macskawc`, régió: **Frankfurt (aws-eu-central-1)** vagy a hozzád legközelebbi európai régió.
3. Az adatbázis oldalán másold ki az URL-t (így kezdődik: `libsql://...`). Ez lesz a `TURSO_DATABASE_URL`.
4. Ugyanitt: **Create Token** / **Generate Token**, jogosultság: Read & Write, lejárat: Never. Másold ki – ez a `TURSO_AUTH_TOKEN`. (Csak egyszer jelenik meg.)

## 2. Render szolgáltatás (kb. 5 perc)

1. Regisztrálj: https://render.com (a „GitHub” belépés a legegyszerűbb), és engedélyezd a hozzáférést a tárolóhoz.
2. **New → Blueprint**, válaszd ki a tárolót. A Render beolvassa a `render.yaml` fájlt (ingyenes csomag, Frankfurt).
3. Töltsd ki a kért értékeket:
   - `TURSO_DATABASE_URL` – az 1/3. lépésből
   - `TURSO_AUTH_TOKEN` – az 1/4. lépésből
   - `ADMIN_EMAIL` – az admin belépési e-mail címe
   - `ADMIN_PASSWORD` – az admin kezdő jelszava (min. 8 karakter)
4. **Apply / Deploy**. Az első telepítés 3–5 perc. A cím így fog kinézni: `https://macskawc.onrender.com` (ha foglalt, a Render utótagot tesz hozzá).

## 3. Első belépés

1. Nyisd meg a címet telefonon, lépj be az admin adatokkal.
2. Beállítások: cseréld le a jelszót. (Ezután a Renderben megadott kezdő jelszó már nem számít.)
3. A nyilvános cím automatikusan a Render címe lesz; ha saját domaint használsz, írd át a Beállításokban.
4. Vedd fel a családtagokat; mindenki telepítse az ntfy alkalmazást és iratkozzon fel a saját, a Beállításokban látható csatornájára.

## 4. Időzítő (cron-job.org, kb. 3 perc)

A Render ingyenes szolgáltatása 15 perc forgalom nélkül elalszik. Hogy az értesítés 17:00-kor biztosan kimenjen:

1. Regisztrálj: https://cron-job.org
2. **Create cronjob**, URL: a Beállítások oldal alján látható cron-cím (`https://…/api/cron?key=…`).
3. Gyakoriság: **10 percenként**. Mentés.

A havi 750 ingyenes Render-óra egy folyamatosan ébren tartott szolgáltatásra pont elég.

## Tudnivalók

- Frissítés: ha a GitHub-tárolóba új kód kerül, a Render automatikusan újratelepít. Az adatok a Tursóban maradnak.
- Helyi futtatás: `npm install`, majd `npm run dev` – Turso nélkül helyi `data.db` fájlt használ.
- Ha a Turso helyi másolata (embedded replica) bármiért gondot okozna, a `TURSO_REPLICA=0` környezeti változóval közvetlen távoli kapcsolatra vált.
