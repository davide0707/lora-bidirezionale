#ifndef EMA_ADAPTIVE_H
#define EMA_ADAPTIVE_H

#include <math.h>
#include <stdint.h>

/* -------- Parametri base -------- */
#define EMA_ALPHA_MIN      0.001f
#define EMA_ALPHA_MAX      0.2f
#define EMA_BETA           0.99f
#define EMA_PWR_P          2.0f
#define EMA_EPS            1e-9f

/* wrap di un angolo in (-180,180] */
static inline float wrap_deg(float a) {
    while (a <= -180.0f) a += 360.0f;
    while (a >  180.0f)  a -= 360.0f;
    return a;
}

/* Stato di un filtro EMA adattivo */
typedef struct {
    float m;       // media exp innovazione
    float s2;      // varianza exp innovazione
    float alpha;   // guadagno istantaneo
    float alpha_min, alpha_max;
    float beta, p;
    float y;       // uscita
} EMA1_Adaptive;

/* Stato circolare per angoli in gradi */
typedef struct {
    EMA1_Adaptive core;
    float c, s;
} EMA1_CircularDeg;

/* --- inizializza filtro scalare --- */
static inline void ema1_adaptive_init(EMA1_Adaptive* st, float y0) {
    st->m = 0.0f; st->s2 = 1e-6f;
    st->alpha = EMA_ALPHA_MIN;
    st->alpha_min = EMA_ALPHA_MIN;
    st->alpha_max = EMA_ALPHA_MAX;
    st->beta = EMA_BETA;
    st->p = EMA_PWR_P;
    st->y = y0;
}

/* --- aggiorna filtro scalare --- */
static inline float ema1_adaptive_update(EMA1_Adaptive* st, float xk) {
    float e = xk - st->y;
    st->m  = st->beta * st->m  + (1.0f - st->beta) * e;
    float de = e - st->m;
    st->s2 = st->beta * st->s2 + (1.0f - st->beta) * (de * de);
    float s = sqrtf(st->s2) + EMA_EPS;
    float u = fabsf(de) / s;
    float up = powf(u, st->p);
    float a  = st->alpha_min + (st->alpha_max - st->alpha_min) * (up / (1.0f + up));
    st->alpha = a;
    st->y += a * e;
    return st->y;
}

/* --- inizializza filtro circolare (angoli) --- */
static inline void ema1_circdeg_init(EMA1_CircularDeg* st, float theta0_deg) {
    ema1_adaptive_init(&st->core, theta0_deg);
    float r = theta0_deg * (float)M_PI / 180.0f;
    st->c = cosf(r);
    st->s = sinf(r);
}

/* --- aggiorna filtro circolare --- */
static inline float ema1_circdeg_update(EMA1_CircularDeg* st, float theta_deg) {
    float e_ang = wrap_deg(theta_deg - st->core.y);
    st->core.m  = st->core.beta * st->core.m + (1.0f - st->core.beta) * e_ang;
    float de    = e_ang - st->core.m;
    st->core.s2 = st->core.beta * st->core.s2 + (1.0f - st->core.beta) * (de * de);
    float sdev  = sqrtf(st->core.s2) + EMA_EPS;
    float u     = fabsf(de) / sdev;
    float up    = powf(u, st->core.p);
    float a     = st->core.alpha_min + (st->core.alpha_max - st->core.alpha_min) * (up / (1.0f + up));
    st->core.alpha = a;
    float r = theta_deg * (float)M_PI / 180.0f;
    st->c = (1.0f - a) * st->c + a * cosf(r);
    st->s = (1.0f - a) * st->s + a * sinf(r);
    float y_rad = atan2f(st->s, st->c);
    float y_deg = y_rad * 180.0f / (float)M_PI;
    st->core.y  = y_deg;
    return y_deg;
}

#endif
