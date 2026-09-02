// B22a — PV-Zeitreihengenerator, reiner Umrechnungskern (kein Netz, keine App-Anbindung).
// Der Netzaufruf gegen PVGIS liegt als Proxy in `apps/website/lib/pvgis/`; hier steht
// ausschliesslich, was ohne Netz prüfbar ist.
export * from './pvgis'
export * from './reference-profile'
export * from './couple'
