#include "scl3300.h"
#include <stdio.h>
#include <string.h>
#include "spi.h"
#include "lora_app.h"
#include "ema_adaptive.h"


void SCL3300_DebugDump(void);


#define SCL3300_AVG_SAMPLES 100  // numero di letture da mediare
uint8_t result;
char msg[256];
uint8_t rx_buf[256];
int x_ok,y_ok,z_ok,temp_ok;
int in_calibrazione = 0;  //
int sensore_pronto = 0;  //

SCL3300_t sensor;
/* Filtro esponenziale adattivo per ogni asse */
static EMA1_CircularDeg fx, fy, fz;
static EMA1_Adaptive ftemp;

/* ---------------------------------------------------------
   Static helpers
   --------------------------------------------------------- */
static void CS_High(void)  { HAL_GPIO_WritePin(SCL_CS_GPIO_Port, SCL_CS_Pin, GPIO_PIN_SET); }
static void CS_Low(void)   { HAL_GPIO_WritePin(SCL_CS_GPIO_Port, SCL_CS_Pin, GPIO_PIN_RESET); }


/* CRC8 (polinomio x⁸ + x⁴ + x³ + x² + 1, 0x1D) */
static uint8_t CRC8_CalcBit(uint8_t BitValue, uint8_t CRC_)
{
    uint8_t Temp = CRC_ & 0x80;
    if (BitValue == 1) Temp ^= 0x80;
    CRC_ <<= 1;
    if (Temp) CRC_ ^= 0x1D;
    return CRC_;
}

uint8_t CalculateCRC(uint32_t Data)
{
    uint8_t BitIndex;
    uint8_t BitValue;
    uint8_t CRC_ = 0xFF;

    for (BitIndex = 31; BitIndex > 7; BitIndex--)
    {
        BitValue = (uint8_t)((Data >> BitIndex) & 0x01);
        CRC_ = CRC8_CalcBit(BitValue, CRC_);
    }
    return (uint8_t)(~CRC_);
}

/* ---------------------------------------------------------
   SPI Core I/O
   --------------------------------------------------------- */
uint8_t write_reg(uint32_t command)
{
    uint8_t tx[4];
    tx[0] = (command >> 24) & 0xFF;
    tx[1] = (command >> 16) & 0xFF;
    tx[2] = (command >> 8) & 0xFF;
    tx[3] = command & 0xFF;

    CS_Low();
    HAL_SPI_Transmit(SCL_SPI, tx, 4, HAL_MAX_DELAY);
    CS_High();
    HAL_Delay(1);

    return 0;
}

uint8_t read_reg(uint32_t command, uint32_t *data)
{
    uint8_t tx[4], rx[4];
    tx[0] = (command >> 24) & 0xFF;
    tx[1] = (command >> 16) & 0xFF;
    tx[2] = (command >> 8) & 0xFF;
    tx[3] = command & 0xFF;

    CS_Low();
    HAL_SPI_Transmit(SCL_SPI, tx, 4, HAL_MAX_DELAY);
    CS_High();
    HAL_Delay(1);

    CS_Low();
    HAL_SPI_Receive(SCL_SPI, rx, 4, HAL_MAX_DELAY);
    CS_High();

    uint32_t Rxdata = ((uint32_t)rx[0] << 24) | ((uint32_t)rx[1] << 16) | ((uint32_t)rx[2] << 8) | rx[3];
    *data = (Rxdata & 0xFFFFFF00) >> 8;

    uint8_t crc_calc = CalculateCRC(Rxdata);
    if (crc_calc != rx[3])
        return 1;

    return 0;
}


/* ---------------------------------------------------------
   INITIALIZATION SEQUENCE (datasheet section 4.2)
   --------------------------------------------------------- */
void SPI_Test(void)
{
  uint8_t tx[4] = {0x80, 0x00, 0x00, 0x00};
  uint8_t rx[4] = {0};

  HAL_GPIO_WritePin(SCL_CS_GPIO_Port, SCL_CS_Pin, GPIO_PIN_RESET);
  HAL_SPI_TransmitReceive(&hspi2, tx, rx, 4, HAL_MAX_DELAY);
  HAL_GPIO_WritePin(SCL_CS_GPIO_Port, SCL_CS_Pin, GPIO_PIN_SET);

  sprintf(msg, "SPI RX: %02X %02X %02X %02X\r\n", rx[0], rx[1], rx[2], rx[3]);
  HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);
}

void Calibra_Offset(void)
{
    in_calibrazione = 1;
    HAL_UART_Transmit(&huart1, (uint8_t *)"Calibrating offset... [", 23, HAL_MAX_DELAY);

    float sumX = 0, sumY = 0, sumZ = 0;
    int samples = 100;

    for (int i = 0; i < samples; i++)
    {
        Ang_X(&sensor);
        Ang_Y(&sensor);
        Ang_Z(&sensor);

        sumX += sensor.ANG_X;
        sumY += sensor.ANG_Y;
        sumZ += sensor.ANG_Z;

        // animazione progress bar ogni 10%
        if (i % 10 == 0)
        {
            char bar[10];
            int percent = (i * 100) / samples;
            int filled = percent / 10;
            memset(bar, '#', filled);
            memset(bar + filled, '.', 10 - filled);
            bar[10] = '\0';

            sprintf(msg, "\rCalibrating offset... [%s] %d%%", bar, percent);
            HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);
        }

        HAL_Delay(50);
    }

    offset_X = sumX / samples;
    offset_Y = sumY / samples;
    offset_Z = sumZ / samples;

    sprintf(msg, "\rCalibrating offset... [##########] 100%%\r\n Offset set to X: %.2f | Y: %.2f | Z: %.2f\r\n",
            offset_X, offset_Y, offset_Z);
    HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);

    in_calibrazione = 0; // fine calibrazione
}




uint8_t SCL3300_Init(void)
{




    uint8_t rs;
    uint32_t value;
    char msg[128];

    HAL_UART_Transmit(&huart1, (uint8_t *)"--- SCL3300 Initialization Start ---\r\n", 39, HAL_MAX_DELAY);
    HAL_Delay(100);

    /* Step 1: Wake-up e reset */
    HAL_UART_Transmit(&huart1, (uint8_t *)"Initializing SCL3300...\r\n", 26, HAL_MAX_DELAY);
    write_reg(WKUP_FROM_POW_DOWN);
    HAL_Delay(10);
    write_reg(SW_RESET);
    HAL_Delay(50);

    /* Step 2: Test SPI */
    HAL_UART_Transmit(&huart1, (uint8_t *)"Testing SPI...\r\n", 17, HAL_MAX_DELAY);
    SPI_Test();
    HAL_Delay(100);

    /* Step 3: Configurazione modalità e output */
    write_reg(CHANGE_TO_MODE2);
    HAL_Delay(20);
    write_reg(ENABLE_ANG_OUTPUTS);
    HAL_Delay(20);
    write_reg(SWITCH_TO_BANK0);
    HAL_Delay(20);

    /* Step 4: Lettura stato */
    read_reg(READ_STATUS_SUMMARY, &value);
    rs = (value >> 16) & 0xFF;
    sprintf(msg, "STATUS_SUMMARY: 0x%06lX (RS=%02X)\r\n", value, rs);
    HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);

    /* Step 5: WHOAMI */
    read_reg(READ_WHOAMI, &value);
    uint8_t whoami = (value >> 8) & 0xFF;
    sprintf(msg, "WHOAMI raw: 0x%06lX (WHOAMI=%02X)\r\n", value, whoami);
    HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);

    /* Step 6: Verifica stato */
    if (rs == RS_NORMAL && whoami == WHOAMI_EXPECTED)
    {
        HAL_UART_Transmit(&huart1, (uint8_t *)"SCL3300 Initialized Successfully!\r\n", 35, HAL_MAX_DELAY);

        /* Debug info opzionale */
        SCL3300_DebugDump();
        HAL_Delay(200);

        /* Step 7: Calibrazione automatica con animazione */
        in_calibrazione = 1;
        HAL_UART_Transmit(&huart1, (uint8_t *)"Calibrating offset... [", 23, HAL_MAX_DELAY);

        float sumX = 0, sumY = 0, sumZ = 0;
        int samples = 100;
        for (int i = 0; i < samples; i++)
        {
            Ang_X(&sensor);
            Ang_Y(&sensor);
            Ang_Z(&sensor);
            sumX += sensor.ANG_X;
            sumY += sensor.ANG_Y;
            sumZ += sensor.ANG_Z;

            // animazione progress bar ogni 10%
            if (i % 10 == 0)
            {
                char bar[11];
                int percent = (i * 100) / samples;
                int filled = percent / 10;
                memset(bar, '#', filled);
                memset(bar + filled, '.', 10 - filled);
                bar[10] = '\0';
                sprintf(msg, "\rCalibrating offset... [%s] %3d%%", bar, percent);
                HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);
            }

            HAL_Delay(50);
        }

        offset_X = sumX / samples;
        offset_Y = sumY / samples;
        offset_Z = sumZ / samples;

        sprintf(msg, "\rCalibrating offset... [##########] 100%%\r\n✅ Offset set to X: %.2f | Y: %.2f | Z: %.2f\r\n",
                offset_X, offset_Y, offset_Z);
        HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);

        in_calibrazione = 0;   // sblocco
        sensore_pronto = 1;    // 🔹 ora il sensore è pronto
        HAL_UART_Transmit(&huart1, (uint8_t *)"SCL3300 Ready!\r\n", 17, HAL_MAX_DELAY);
        /* Inizializza filtri EMA con gli angoli calibrati */
        ema1_circdeg_init(&fx, sensor.ANG_X - offset_X);
        ema1_circdeg_init(&fy, sensor.ANG_Y - offset_Y);
        ema1_circdeg_init(&fz, sensor.ANG_Z - offset_Z);
        ema1_adaptive_init(&ftemp, sensor.TEMP);

        return 0;
    }

    /* Se fallisce */
    sensore_pronto = 0;
    return 1;

}

void calibrazione(){
    /* Ora l'inizializzazione completa è gestita da SCL3300_Init() */
    result = SCL3300_Init();

    /* Boot CPU2 (LoRa core) if required */
    //HAL_PWREx_ReleaseCore(PWR_CORE_CPU2);

    /* Avvio ricezione UART in interrupt */
    HAL_UART_Receive_IT(&huart1, rx_buf, sizeof(rx_buf) - 1);
}
void CalcoloAngoli(void)
{
    if (!sensore_pronto || in_calibrazione)
        return;

    x_ok = Ang_X(&sensor);
    y_ok = Ang_Y(&sensor);
    z_ok = Ang_Z(&sensor);
    temp_ok = Temp(&sensor);

    if (x_ok == 0 && y_ok == 0 && z_ok == 0 && temp_ok == 0)
    {
    	float rawX = sensor.ANG_X - offset_X;
    	float rawY = sensor.ANG_Y - offset_Y;
    	float rawZ = sensor.ANG_Z - offset_Z;

    	/* Aggiorna i filtri */
    	float Xf = ema1_circdeg_update(&fx, rawX);
    	float Yf = ema1_circdeg_update(&fy, rawY);
    	float Zf = ema1_circdeg_update(&fz, rawZ);
    	float Tf = ema1_adaptive_update(&ftemp, sensor.TEMP);

    	sprintf(msg,
    	    "RAW  X:%.3f Y:%.3f Z:%.3f | FILT X:%.3f Y:%.3f Z:%.3f | αx:%.3f αy:%.3f αz:%.3f | T:%.2f\r\n",
    	    rawX, rawY, rawZ,
    	    Xf, Yf, Zf,
    	    fx.core.alpha, fy.core.alpha, fz.core.alpha,
    	    Tf);


        HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);
    }
}


/* ---------------------------------------------------------
   Letture (convertite secondo datasheet)
   --------------------------------------------------------- */
uint8_t Ang_X(SCL3300_t *dev)
{
    uint32_t value;
    if (read_reg(READ_ANG_X, &value) != 0) return 1;
    dev->ANG_X = (int16_t)(value & 0xFFFF) / 182.0;
    return 0;
}
uint8_t Ang_Y(SCL3300_t *dev)
{
    uint32_t value;
    if (read_reg(READ_ANG_Y, &value) != 0) return 1;
    dev->ANG_Y = (int16_t)(value & 0xFFFF) / 182.0;
    return 0;
}
uint8_t Ang_Z(SCL3300_t *dev)
{
    uint32_t value;
    if (read_reg(READ_ANG_Z, &value) != 0) return 1;
    dev->ANG_Z = (int16_t)(value & 0xFFFF) / 182.0;
    return 0;
}
uint8_t Temp(SCL3300_t *dev)
{
    uint32_t value;
    if (read_reg(READ_TEMPERATURE, &value) != 0) return 1;
    dev->TEMP = (-273.0) + ((int16_t)(value & 0xFFFF) / 18.9);
    return 0;
}

/* ---------------------------------------------------------
   Debug
   --------------------------------------------------------- */
void SCL3300_ReadAveragePerAxis(SCL3300_t *dev)
{
    float sum_x=0, sum_y=0, sum_z=0, sum_t=0;
    int valid_reads = 0;

    for(int i=0; i<SCL3300_AVG_SAMPLES; i++)
    {
        if(Ang_X(dev) == 0 && Ang_Y(dev) == 0 && Ang_Z(dev) == 0 && Temp(dev) == 0)
        {
            sum_x += dev->ANG_X;
            sum_y += dev->ANG_Y;
            sum_z += dev->ANG_Z;
            sum_t += dev->TEMP;
            valid_reads++;
        }
        HAL_Delay(5);  // piccolo ritardo tra letture
    }

    if(valid_reads > 0)
    {
        dev->ANG_X = sum_x / valid_reads;
        dev->ANG_Y = sum_y / valid_reads;
        dev->ANG_Z = sum_z / valid_reads;
        dev->TEMP  = sum_t / valid_reads;
    }
}

void SCL3300_DebugDump(void)
{
    uint32_t val;
    char msg[64];

    read_reg(READ_STATUS_SUMMARY, &val);
    sprintf(msg, "STATUS_SUMMARY=0x%06lX\r\n", val);
    HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);

    read_reg(READ_CURRENT_BANK, &val);
    sprintf(msg, "CURRENT_BANK=0x%06lX\r\n", val);
    HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);

    read_reg(READ_WHOAMI, &val);
    sprintf(msg, "WHOAMI=0x%06lX\r\n", val);
    HAL_UART_Transmit(&huart1, (uint8_t *)msg, strlen(msg), HAL_MAX_DELAY);
}
