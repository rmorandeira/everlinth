# Reglas de la calle (cruces, mobiliario y reparto de la calzada)

Normas del mundo real en las que se basa la generación de la ciudad (godot/scripts/render/city.gd
y traffic.gd). Referencias: NYC DOT *Street Design Manual* y MUTCD (Manual on Uniform Traffic
Control Devices, EE. UU.). Unidades del juego: 1 tile = 1,5 m.

## Reparto de la calzada

| Calle | Carriles | Aparcamiento |
|---|---|---|
| Menor, doble sentido (3,2 tiles = 4,8 m) | 1 por sentido | No (no cabe) |
| Menor, sentido único | 1 | Junto al bordillo, un solo lado |
| Principal (4,8 tiles = 7,2 m) | 1 por sentido | Ambos lados |
| Avenida (6,8 tiles = 10,2 m) | 2 por sentido | No |

- Se circula por la derecha.
- No se aparca a menos de 6 m (4 tiles) de un paso de peatones o de un cruce, ni a
  menos de 4,5 m (3 tiles) de un hidrante.

## Cruces

1. **Pasos de peatones** en todos los brazos de los cruces con semáforo o STOP en todas las
   direcciones, justo fuera del cruce. Tipo "continental": barras paralelas al tráfico de
   3 m (2 tiles) de largo y 0,6 m de ancho, separadas 0,6 m.
2. **Línea de detención**: blanca, 0,6 m, 1,2 m (≈1 tile) antes del paso de peatones, sobre
   los carriles que llegan (en todos los brazos con semáforo o STOP).
3. **Semáforos** (MUTCD): en el **lado lejano** del cruce. El poste va en la esquina de la
   derecha una vez cruzado, con el brazo sobre los carriles que llegan y una cabeza por
   carril mirando a los coches. Semáforo peatonal en el poste mirando al otro lado del paso.
4. **STOP**: señal octogonal roja (0,75 m) en poste de 2,1 m en la esquina derecha de cada
   brazo con STOP, a la altura de la línea de detención, más "STOP" pintado en el carril.
5. **Esquinas** (zona de mobiliario, a 0,3-1 m del bordillo, sin invadir el paso):
   papelera de rejilla verde en las esquinas; hidrante en esquinas alternas, a 1,5-3 m del
   paso; farola en una diagonal de los cruces grandes.

## Mobiliario a lo largo de la manzana

- **Farolas** cobra: cada ~27 m (18 tiles), alternando lados, a 0,9 m del bordillo; nunca a
  menos de 6 m (4 tiles) de un cruce (las esquinas ya tienen la suya).
- **Árboles** en alcorque: cada ~9-12 m, no a menos de 9 m (6 tiles) de un cruce, ni a menos
  de 1,5 tiles de una farola, un hidrante o un semáforo.
- **Bancos** mirando a la calle y **contenedores** junto al bordillo a media manzana
  (nunca en esquinas).
- **Bolsas de basura** apiladas junto al bordillo delante de los portales (Nueva York).
- Nada dentro de un edificio ni a menos de 0,5 tiles de su fachada; nada sobre la calzada
  salvo los coches.

## Aceras

- Losas de hormigón de 1,5 m (1 tile) con juntas; tonos y manchas distintos por losa,
  chicles, grietas, parches.
- Basura: papeles, periódicos, latas, colillas y hojas, sobre todo en la cuneta, junto a
  las papeleras y en las fachadas.

## Paseantes

- Van por las aceras y cruzan por los pasos de peatones; solo invaden la calzada huyendo.
