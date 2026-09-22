-- Ausgangslage von Schritt 1/2: an Zählpunkt 1 hängt eine gelesene Rechnung.
update platform.metering_points
   set draft = jsonb_build_object(
     '_invoiceExtractions', jsonb_build_array(jsonb_build_object(
       'documentId', '33333333-3333-4333-8333-333333333333',
       'filename', 'netzrechnung-2025.pdf',
       'extraction', jsonb_build_object(
         'netzbetreiber', 'wiener-netze',
         'netzebene', 7,
         'meteringVariant', 'mit-leistungsmessung',
         'annualConsumptionKwh', 41000,
         'energyPriceBasis', 'stated',
         'rates', jsonb_build_object('energyPriceCtPerKwh', 11.2)
       ))),
     'netzbetreiber', 'wiener-netze',
     'netzebene', 'NE 7',
     'meteringVariant', 'mit-leistungsmessung',
     'annualConsumptionKwh', 41000,
     'energyPriceCtPerKwh', 11.2
   )
 where id = '22222222-2222-4222-8222-222222222222';
select jsonb_pretty(draft) from platform.metering_points where id = '22222222-2222-4222-8222-222222222222';
