/*
 * scl3300.h
 *
 *  Created on: Oct 28, 2025
 *      Author: Davide Di Filippo
 */

#ifndef INC_SCL3300_H_
#define INC_SCL3300_H_

#ifdef __cplusplus
extern "C" {
#endif

#include "spi.h"
#include "usart.h"
#include "gpio.h"
#include "main.h"
#include <stdint.h>
/* === Variabili globali e funzioni pubbliche === */
extern int in_calibrazione;
extern int sensore_pronto;

void calibrazione(void);
void CalcoloAngoli(void);
void SCL3300_DebugDump(void);



/* =========================================================
   STRUCT DATI
   ========================================================= */
typedef struct {
    double ACC_X;
    double ACC_Y;
    double ACC_Z;
    double ANG_X;
    double ANG_Y;
    double ANG_Z;
    double TEMP;

    // Filtro EMA
    float filtX;
    float filtY;
    float filtZ;
    float filtT;

    // Offset
    float offsetX;
    float offsetY;
    float offsetZ;

    // Diagnostica
    uint32_t spiErrors;
    uint32_t crcErrors;
    uint8_t  fatal;        // 1 = sensore non risponde
    uint8_t  calibrated;   // 1 = offset valido
} SCL3300_t;

/* =========================================================
   CONFIGURAZIONE HARDWARE
   ========================================================= */
#define SCL_SPI          (&hspi2)
#define SCL_CS_GPIO_Port GPIOB
#define SCL_CS_Pin       GPIO_PIN_9

/* =========================================================
   CODICI DI COMANDO (da datasheet Murata SCL3300-D01)
   ========================================================= */
/* Letture base */
#define READ_ACC_X             0x040000F7
#define READ_ACC_Y             0x080000FD
#define READ_ACC_Z             0x0C0000FB
#define READ_ANG_X             0x240000C7
#define READ_ANG_Y             0x280000CD
#define READ_ANG_Z             0x2C0000CB
#define READ_TEMPERATURE       0x140000EF
#define READ_STATUS_SUMMARY    0x180000E5
#define READ_STO               0x100000E9
#define READ_WHOAMI            0x40000091
#define READ_ERR_FLAG1         0x1C0000E3
#define READ_ERR_FLAG2         0x200000C1
#define READ_CURRENT_BANK      0x7C0000B3
#define READ_SERIAL1           0x640000A7
#define READ_SERIAL2           0x680000AD

/* Comandi di configurazione */
#define ENABLE_ANG_OUTPUTS     0xB0001F6F
#define CHANGE_TO_MODE1        0xB400001F
#define CHANGE_TO_MODE2        0xB4000102
#define CHANGE_TO_MODE3        0xB4000225
#define CHANGE_TO_MODE4        0xB4000338
#define WKUP_FROM_POW_DOWN     0xB400001F
#define SW_RESET               0xB4002098
#define SWITCH_TO_BANK0        0xFC000073
#define SWITCH_TO_BANK1        0xFC00016E

/* Status bits */
#define RS_STARTUP  0x00
#define RS_NORMAL   0x01
#define RS_SELFTEST 0x02
#define RS_ERR      0x03

/* WHOAMI atteso (8-bit) */
#define WHOAMI_EXPECTED  0xC1

/* =========================================================
   PROTOTIPI DELLE FUNZIONI
   ========================================================= */
uint8_t  SCL3300_InitWithRetry(uint8_t tries);
uint8_t  read_reg(uint32_t command, uint32_t *data);
uint8_t  write_reg(uint32_t command);
uint8_t  CalculateCRC(uint32_t data);

uint8_t  Acc_X(SCL3300_t *dev);
uint8_t  Acc_Y(SCL3300_t *dev);
uint8_t  Acc_Z(SCL3300_t *dev);
uint8_t  Ang_X(SCL3300_t *dev);
uint8_t  Ang_Y(SCL3300_t *dev);
uint8_t  Ang_Z(SCL3300_t *dev);
uint8_t  Temp(SCL3300_t *dev);
uint8_t  STO_Sensor(SCL3300_t *dev);

uint8_t  SCL3300_ReadAverage(SCL3300_t *dev, uint8_t samples,
                             float *avgX, float *avgY, float *avgZ, float *avgT);

void     SCL3300_SoftReset(void);
void     SCL3300_Sleep(void);
void     SCL3300_Wake(void);

#ifdef __cplusplus
}
#endif

#endif /* INC_SCL3300_H_ */
