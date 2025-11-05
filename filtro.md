
# LoRa + SCL3300 — Calibrazione, EMA Adattivo (Scalare & Circolare) e Pipeline Dati

---

## Indice

1. [Panoramica](#panoramica)
2. [Prerequisiti & File](#prerequisiti--file)
3. [Notazione & Convenzioni](#notazione--convenzioni)
4. [Calibrazione degli offset (media statica)](#calibrazione-degli-offset-media-statica)
5. [EMA adattivo (scalare)](#ema-adattivo-scalare)
   - [Ricorrenza EMA base](#ricorrenza-ema-base)
   - [Innovazione, media/varianza esponenziale](#innovazione-mediavarianza-esponenziale)
   - [Significatività → α adattivo](#significatività--α-adattivo)
   - [Update dello stato](#update-dello-stato)
6. [EMA adattivo circolare (angoli in gradi)](#ema-adattivo-circolare-angoli-in-gradi)
   - [Wrap & distanza angolare](#wrap--distanza-angolare)
   - [Media circolare con cos/sin](#media-circolare-con-cossin)
   - [Passi d’aggiornamento](#passi-daggiornamento)
7. [Parametri, significato e trade-off](#parametri-significato-e-trade-off)
8. [Mappatura codice ⇄ matematica](#mappatura-codice--matematica)
9. [Sequenza: init, calibrazione, run](#sequenza-init-calibrazione-run)
10. [Aggiornamento periodico & log](#aggiornamento-periodico--log)
11. [Payload LoRa (opzionale)](#payload-lora-opzionale)
12. [Considerazioni numeriche & temporali](#considerazioni-numeriche--temporali)
13. [Tuning pratico passo-passo](#tuning-pratico-passo-passo)
14. [Esempi di codice](#esempi-di-codice)
15. [Debug & Troubleshooting](#debug--troubleshooting)
16. [Licenza](#licenza)

---

## Panoramica

**Obiettivo:** ottenere valori stabili e reattivi.  
Catena di elaborazione (per ogni campione):

1. **Lettura registri**: `READ_ANG_X/Y/Z`, `READ_TEMPERATURE`.
2. **Compensazione offset**: sottrazione `o_X/o_Y/o_Z` calcolati a fermo.
3. **Filtraggio:**
   - **Temperatura** → **EMA scalare** (IIR 1° ordine con α adattivo).
   - **Angoli** → **EMA circolare** (gestisce il wrap ±180°).
4. **Output**: valori filtrati su UART + (opz.) impacchettati per LoRa.

```
[SCL3300] ──► [Offset Calib] ──► [EMA-Adaptive: T] ──►
                         └──► [EMA-Circular: X/Y/Z] ──► [UART/LoRa]
```

---

## Prerequisiti & File

- MCU con SPI + UART + stack LoRa (opz.).
- File di progetto tipici:
  - `scl3300.c/.h` — driver sensore e funzioni di lettura.
  - `ema_adaptive.h/.c` — implementazione dei filtri.
  - `main.c` — init, loop, logging, payload.

---

## Notazione & Convenzioni

- **Gradi**: angoli in **°**.
- **Wrap**: intervallo **(−180, 180]**.
- **Simboli comuni**:
  - `x_k`: campione corrente
  - `y_k`: uscita filtrata
  - `α`: gain EMA (0 < α ≤ 1)
  - `β`: fattore di “memoria” per stime esponenziali (0 < β < 1)
  - `ε`: piccolo stabilizzatore numerico (es. 1e−6)

---

## Calibrazione degli offset (media statica)

**Matematica.** Con N campioni a fermo:

$$
o_X=\frac{1}{N}\sum_{i=1}^N x_i,\quad
o_Y=\frac{1}{N}\sum_{i=1}^N y_i,\quad
o_Z=\frac{1}{N}\sum_{i=1}^N z_i
$$

Compensazione per i campioni successivi:

$$
\tilde{x}_k=x_k-o_X,\quad
\tilde{y}_k=y_k-o_Y,\quad
\tilde{z}_k=z_k-o_Z
$$

**Nota pratica:** usare **N=100..300**; evitare vibrazioni; fissare il dispositivo.

---

## EMA adattivo (scalare)

### Ricorrenza EMA base

$$
y_k = y_{k-1} + \alpha\,(x_k - y_{k-1}),\quad 0<\alpha\le 1
$$

- α **grande** → più reattivo (meno smoothing)
- α **piccolo** → più liscio (più ritardo)

### Innovazione, media/varianza esponenziale

$$
\begin{aligned}
e_k &= x_k - y_{k-1} \\
m_k &= \beta\,m_{k-1} + (1-\beta)\,e_k \\
d_k &= e_k - m_k \\
s_k^2 &= \beta\,s_{k-1}^2 + (1-\beta)\,d_k^2
\end{aligned}
$$

- `m_k`: tendenza lenta dell’innovazione
- `d_k`: residuo centrato
- `s_k`: deviazione standard stimata

### Significatività → α adattivo

$$
u_k = \frac{|d_k|}{s_k + \varepsilon},\qquad
\alpha_k = \alpha_{\min} + (\alpha_{\max}-\alpha_{\min})\frac{u_k^p}{1+u_k^p}
$$

- **Quiete**: \(u\approx0 \Rightarrow \alpha\approx\alpha_{\min}\)
- **Transitorio**: \(u\gg1 \Rightarrow \alpha\rightarrow\alpha_{\max}\)

### Update dello stato

$$
y_k = y_{k-1} + \alpha_k\,(x_k - y_{k-1})
$$

---

## EMA adattivo circolare (angoli in gradi)

### Wrap & distanza angolare

Funzione wrap in \((-180,180]\):

```c
static inline float wrap_deg(float a) {
    if (a <= -180.0f) return a + 360.0f;
    if (a >  180.0f)  return a - 360.0f;
    return a;
}
```

Innovazione angolare:

$$
e_k^\theta = \mathrm{wrap}(\theta_k - y_{k-1}^\theta)
$$

> **Importante**: il calcolo di \( \alpha_k \) usa **questa** innovazione “wrapped”.

### Media circolare con cos/sin

$$
\begin{aligned}
c_k &= (1-\alpha_k)\,c_{k-1} + \alpha_k\cos(\theta_k) \\
s_k &= (1-\alpha_k)\,s_{k-1} + \alpha_k\sin(\theta_k) \\
y_k^\theta &= \mathrm{atan2}(s_k, c_k)\quad[\text{gradi}]
\end{aligned}
$$

- \((c,s)\) rappresenta coerentemente la media su cerchio.
- Si evita il “salto” 179° → −179° trattandolo come **+2°**, non **−358°**.

### Passi d’aggiornamento

1. **Errore angolare**: \( e = \mathrm{wrap}(\theta - y^\theta) \)
2. **Stime esponenziali**: \( m, s^2 \) su \( e \)
3. **u → α** (curva “soft”)
4. **Media circolare** con \( \alpha \) calcolato al punto 3.

---

## Parametri, significato e trade-off

| Parametro        | Ruolo                                      | Tipico           | Effetto/Trade-off                                  |
|------------------|--------------------------------------------|------------------|----------------------------------------------------|
| `EMA_ALPHA_MIN`  | α in quiete                                | 0.02 … 0.08      | Più piccolo = più liscio ma maggiore ritardo       |
| `EMA_ALPHA_MAX`  | α in transitorio                           | 0.3 … 0.7        | Più grande = più reattivo ma meno smoothing        |
| `EMA_BETA`       | memoria stime esponenziali                 | 0.98 … 0.995     | Alto = stima rumore più stabile ma più lenta       |
| `EMA_PWR_P`      | ripidità mappatura \(u\to\alpha\)          | 2 (quadratico)   | Più alto = transizione più brusca                  |
| `EMA_EPS`        | stabilizzatore numerico                    | 1e−6 … 1e−4      | Evita div/0; non alterare troppo la dinamica       |

**Regola d’oro:** inizia con *(0.04, 0.5, 0.99, 2, 1e−6)*, poi affina.

---

## Mappatura codice ⇄ matematica

| Matematica | Codice (concetto) |
|------------|-------------------|
| \( e_k = x_k - y_{k-1} \) | `e = x - y;` |
| \( m_k = \beta m_{k-1} + (1-\beta)e_k \) | `m = β*m + (1-β)*e;` |
| \( d_k = e_k - m_k \) | `de = e - m;` |
| \( s_k^2 = \beta s_{k-1}^2 + (1-\beta) d_k^2 \) | `s2 = β*s2 + (1-β)*de*de;` |
| \( u_k = |d_k|/(s_k+\varepsilon) \) | `u = fabs(de)/(sqrt(s2)+EPS);` |
| \( \alpha_k = \alpha_\min + (\alpha_\max-\alpha_\min)\frac{u^p}{1+u^p} \) | `a = αmin + (αmax-αmin)*(up/(1+up));` |
| \( y_k = y_{k-1} + \alpha_k(x_k-y_{k-1}) \) | `y += a*e;` |

---

## Sequenza: init, calibrazione, run

1. **`SCL3300_Init()`**
   - Reset/wake, setup SPI/banchi/modi.
   - Check `STATUS_SUMMARY`, `WHOAMI`.

2. **`Calibra_Offset(N)`**
   - Leggi N campioni per X/Y/Z.
   - Calcola `oX, oY, oZ`.
   - Stampa risultati.

3. **Init filtri** con valori **compensati**:
   ```c
   ema1_circdeg_init(&fx, ANG_X - oX);
   ema1_circdeg_init(&fy, ANG_Y - oY);
   ema1_circdeg_init(&fz, ANG_Z - oZ);
   ema1_adaptive_init(&ftemp, TEMP);
   ```

4. **Flag**:
   - `in_calibrazione = true` durante la media offset.
   - `sensore_pronto = true` dopo init+calibrazione.

---

## Aggiornamento periodico & log

- Eseguito se `sensore_pronto && !in_calibrazione`.
- Passi:
  1. Leggi registri.
  2. Compensa offset angoli.
  3. Aggiorna filtri (`X/Y/Z` circolare, `T` scalare).
  4. Log UART.

**Formato log (esempio):**
```
RAW  X:  12.34  Y:  -0.80  Z: 179.10  |  FILT X: 12.20  Y: -0.77  Z: -179.5  |  αx:0.056 αy:0.041 αz:0.310  |  T: 27.8°C
```

---

## Payload LoRa (opzionale)

**Consiglio**: inviare **filtrati** \(X_f, Y_f, Z_f, T_f\) per ridurre rumore e banda sprecata.

### Packing (esempio compatto 10 byte)

- Scala angoli in **centidegrees** (°×100) → `int16_t` (−18000..18000)
- Temperatura in **centi-°C** (×100) → `int16_t`
- Ordine: `Xc, Yc, Zc, Tc, Flags(α compattati opz.)`

```c
int16_t Xc = (int16_t)lrintf(Xf * 100.0f);
int16_t Yc = (int16_t)lrintf(Yf * 100.0f);
int16_t Zc = (int16_t)lrintf(Zf * 100.0f);
int16_t Tc = (int16_t)lrintf(Tf * 100.0f);

uint8_t buf[8];
memcpy(&buf[0], &Xc, 2);
memcpy(&buf[2], &Yc, 2);
memcpy(&buf[4], &Zc, 2);
memcpy(&buf[6], &Tc, 2);
// invia buf[0..7]
```

> **Nota:** se servono anche gli α istantanei, trasmetti 1 byte con `α ∈ [0,1]` quantizzato su 0..255.

---

## Considerazioni numeriche & temporali

- **Stabilità:** filtro IIR 1° con polo \(1-\alpha_k \in [1-\alpha_{\max}, 1-\alpha_{\min})\) ⇒ **sempre stabile**.
- **Ritardo medio:** circa \(\frac{1-\alpha}{\alpha}\cdot\frac{\Delta t}{2}\). Con α adattivo, il ritardo **si riduce** durante i transitori.
- **Δt non uniforme:** supportato; stimatori esponenziali sono **stazionari** rispetto al conteggio, non al tempo. Se Δt varia molto, considera α/β tempo-dipendenti.
- **Float vs double:** `float` basta su MCU; usa `sqrtf`, `atan2f`, `cosf`, `sinf`.
- **EPS:** scegli il più piccolo possibile senza instabilità (1e−6 tipico su float).

---

## Tuning pratico passo-passo

1. **Offset**: rifai la calibrazione a fermo → logga `oX/oY/oZ`.
2. **Quietezza**: osserva α in quiete; se fluttua, **aumenta β** o **riduci α_min**.
3. **Reattività**: esegui step/tilt rapido; se lento, **aumenta α_max** o **riduci β**.
4. **Overshoot/rumore**: se overshoot, **riduci α_max** o **aumenta p** (transizione più dolce).
5. **Temperatura**: di solito basta `(α_min=0.02, α_max=0.2, β=0.995, p=2)`.

---

## Esempi di codice

### Strutture & init (`ema_adaptive.h`)

```c
#ifndef EMA_ADAPTIVE_H
#define EMA_ADAPTIVE_H

#include <math.h>
#include <float.h>

#ifndef DEG2RAD
#define DEG2RAD(x) ((x) * (float)M_PI / 180.0f)
#endif
#ifndef RAD2DEG
#define RAD2DEG(x) ((x) * 180.0f / (float)M_PI)
#endif

typedef struct {
    // stime esponenziali su innovazione
    float m;      // media dell'innovazione
    float s2;     // varianza dell'innovazione
    // parametri
    float alpha_min, alpha_max;
    float beta;   // memoria per m e s2
    float p;      // potenza per mappatura u->alpha
    float eps;    // stabilizzatore numerico
    // stato filtro scalare
    float y;      // uscita filtrata
    float alpha;  // alpha corrente (utile per log)
} EMA1_Adaptive;

static inline void ema1_adaptive_init(EMA1_Adaptive *f, float y0,
                                      float alpha_min, float alpha_max,
                                      float beta, float p, float eps) {
    f->m = 0.0f;
    f->s2 = 0.0f;
    f->alpha_min = alpha_min;
    f->alpha_max = alpha_max;
    f->beta = beta;
    f->p = p;
    f->eps = eps;
    f->y = y0;
    f->alpha = alpha_min;
}

// Esegue: (1) aggiorna stime m/s2, (2) calcola alpha, (3) aggiorna y.
static inline float ema1_adaptive_update(EMA1_Adaptive *f, float x) {
    float e  = x - f->y;
    f->m     = f->beta * f->m + (1.0f - f->beta) * e;
    float de = e - f->m;
    f->s2    = f->beta * f->s2 + (1.0f - f->beta) * de * de;
    float u  = fabsf(de) / (sqrtf(f->s2) + f->eps);
    float up = (f->p == 1.0f) ? u : powf(u, f->p);
    float a  = f->alpha_min + (f->alpha_max - f->alpha_min) * (up / (1.0f + up));
    f->y    += a * e;
    f->alpha = a;
    return f->y;
}

typedef struct {
    EMA1_Adaptive core; // usa solo m/s2/alpha per adattività sugli angoli
    float c, s;         // media circolare
    float y;            // angolo filtrato [gradi]
} EMA1_CircularDeg;

static inline float wrap_deg(float a) {
    if (a <= -180.0f) return a + 360.0f;
    if (a >  180.0f)  return a - 360.0f;
    return a;
}

static inline void ema1_circdeg_init(EMA1_CircularDeg *f, float theta0,
                                     float alpha_min, float alpha_max,
                                     float beta, float p, float eps) {
    // inizializza core ma NON usa f->core.y come angolo (teniamo y separato)
    ema1_adaptive_init(&f->core, 0.0f, alpha_min, alpha_max, beta, p, eps);
    f->y = theta0;
    f->c = cosf(DEG2RAD(theta0));
    f->s = sinf(DEG2RAD(theta0));
}

// Aggiorna: calcola alpha su innovazione angolare wrapped, poi media (c,s)
static inline float ema1_circdeg_update(EMA1_CircularDeg *f, float theta_deg) {
    float e_ang = wrap_deg(theta_deg - f->y);

    // --- blocco "solo adattività": aggiorna m/s2/alpha senza modificare un y scalare ---
    // Copia minima di logica di ema1_adaptive_update ma senza il passo "y += a*e".
    float e  = e_ang;                            // innovazione angolare (deg)
    f->core.m  = f->core.beta * f->core.m + (1.0f - f->core.beta) * e;
    float de = e - f->core.m;
    f->core.s2 = f->core.beta * f->core.s2 + (1.0f - f->core.beta) * de * de;
    float u  = fabsf(de) / (sqrtf(f->core.s2) + f->core.eps);
    float up = (f->core.p == 1.0f) ? u : powf(u, f->core.p);
    float a  = f->core.alpha_min + (f->core.alpha_max - f->core.alpha_min) * (up / (1.0f + up));
    f->core.alpha = a;

    // --- media circolare con alpha calcolato ---
    float c_new = (1.0f - a) * f->c + a * cosf(DEG2RAD(theta_deg));
    float s_new = (1.0f - a) * f->s + a * sinf(DEG2RAD(theta_deg));

    // Evita degenerazione vicino a (0,0)
    const float norm = hypotf(c_new, s_new);
    if (norm > 1e-12f) {
        f->c = c_new / norm;
        f->s = s_new / norm;
    } else {
        f->c = c_new;
        f->s = s_new;
    }

    f->y = RAD2DEG(atan2f(f->s, f->c));
    return f->y;
}

#endif // EMA_ADAPTIVE_H
```

### Uso tipico nel loop

```c
// Parametri consigliati
#define A_MIN  0.04f
#define A_MAX  0.55f
#define BETA   0.990f
#define P_PWR  2.0f
#define EPS_   1e-6f

EMA1_CircularDeg fx, fy, fz;
EMA1_Adaptive    ftemp;

void filters_init(float X0, float Y0, float Z0, float T0) {
    ema1_circdeg_init(&fx, X0, A_MIN, A_MAX, BETA, P_PWR, EPS_);
    ema1_circdeg_init(&fy, Y0, A_MIN, A_MAX, BETA, P_PWR, EPS_);
    ema1_circdeg_init(&fz, Z0, A_MIN, A_MAX, BETA, P_PWR, EPS_);
    ema1_adaptive_init(&ftemp, T0, 0.02f, 0.20f, 0.995f, 2.0f, 1e-6f);
}
```

---

## Debug & Troubleshooting

- **α non scende in quiete**: alza `β` (0.995) o riduci `α_min`.
- **Filtro “moscio” ai transitori**: alza `α_max` (0.6..0.7) o abbassa `β`.
- **Oscillazioni/overshoot**: abbassa `α_max` o alza `p` (3).
- **Salti a ±180°**: assicurati di usare `wrap_deg` sull’innovazione e media circolare (cos/sin).
- **Saturazioni**: clamp α in `[α_min, α_max]`, verifica scaling LoRa.

---
