# SCENTORA

Gestionale di produzione per articoli di base, profumi, distinte e carichi. Python 3.12+ e SQLite, senza dipendenze esterne.

## Avvio locale

`SCENTORA_DEMO=1 python app.py` apre la demo su http://localhost:8000 con dati di esempio. Ogni browser ha un archivio temporaneo dedicato. Usa soltanto dati di prova.

## Render per uso operativo

- Crea o configura un Web Service Python dal repository. Avvio `python app.py`, porta assegnata con `PORT`, health check su `/health`.
- Monta un disco persistente su `/var/data` e imposta `SCENTORA_DB=/var/data/scentora.sqlite`. Mantieni una sola istanza per il disco SQLite.
- Imposta `SCENTORA_ADMIN` e `SCENTORA_ADMIN_PASSWORD` come variabili riservate. La password iniziale richiede almeno 5 caratteri e viene salvata come hash durante la prima inizializzazione. Ometti `SCENTORA_DEMO` per l’uso operativo.
- Il carico registra l’operatore e la distinta usata. La giacenza di ogni articolo è espressa nella sua unità di misura. La quantità di distinta si intende per una unità di profumo.
- La copia dell’archivio SQLite va eseguita tramite l’API di backup SQLite o dopo aver arrestato il servizio.

Gli amministratori gestiscono account e unità di misura. Gli operatori gestiscono articoli, profumi e carichi. L’archivio operativo parte vuoto, con le unità `ml.`, `pz.` e `l.`.
