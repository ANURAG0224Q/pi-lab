// Raspberry Pi 40-pin header data (same pinout on Pi 4, Pi 5, Zero 2 W)
export const HEADER = [
  // [physical, name, bcm|null, role, alt]
  [1,'3V3',null,'3v3',''],[2,'5V',null,'5v',''],
  [3,'GPIO2',2,'gpio','SDA1 (I2C)'],[4,'5V',null,'5v',''],
  [5,'GPIO3',3,'gpio','SCL1 (I2C)'],[6,'GND',null,'gnd',''],
  [7,'GPIO4',4,'gpio','GPCLK0 · 1-Wire'],[8,'GPIO14',14,'gpio','TXD (UART)'],
  [9,'GND',null,'gnd',''],[10,'GPIO15',15,'gpio','RXD (UART)'],
  [11,'GPIO17',17,'gpio',''],[12,'GPIO18',18,'gpio','PWM0 · PCM_CLK'],
  [13,'GPIO27',27,'gpio',''],[14,'GND',null,'gnd',''],
  [15,'GPIO22',22,'gpio',''],[16,'GPIO23',23,'gpio',''],
  [17,'3V3',null,'3v3',''],[18,'GPIO24',24,'gpio',''],
  [19,'GPIO10',10,'gpio','MOSI (SPI0)'],[20,'GND',null,'gnd',''],
  [21,'GPIO9',9,'gpio','MISO (SPI0)'],[22,'GPIO25',25,'gpio',''],
  [23,'GPIO11',11,'gpio','SCLK (SPI0)'],[24,'GPIO8',8,'gpio','CE0 (SPI0)'],
  [25,'GND',null,'gnd',''],[26,'GPIO7',7,'gpio','CE1 (SPI0)'],
  [27,'GPIO0',0,'gpio','ID_SD (HAT EEPROM)'],[28,'GPIO1',1,'gpio','ID_SC (HAT EEPROM)'],
  [29,'GPIO5',5,'gpio',''],[30,'GND',null,'gnd',''],
  [31,'GPIO6',6,'gpio',''],[32,'GPIO12',12,'gpio','PWM0'],
  [33,'GPIO13',13,'gpio','PWM1'],[34,'GND',null,'gnd',''],
  [35,'GPIO19',19,'gpio','PWM1 · PCM_FS · MISO1'],[36,'GPIO16',16,'gpio','CE2 (SPI1)'],
  [37,'GPIO26',26,'gpio',''],[38,'GPIO20',20,'gpio','MOSI1 · PCM_DIN'],
  [39,'GND',null,'gnd',''],[40,'GPIO21',21,'gpio','SCLK1 · PCM_DOUT'],
];
export const BCM_TO_PHYS = {};
export const PHYS_TO_BCM = {};
for (const [p, , b] of HEADER) if (b !== null) { BCM_TO_PHYS[b] = p; PHYS_TO_BCM[p] = b; }
export const HW_PWM = { 12: 0, 13: 1, 18: 0, 19: 1 };
// Power-on default pulls of the BCM2711/BCM2835 family: GPIO0-8 pull-up, 9-27 pull-down
export function bootPull(bcm) { return bcm <= 8 ? 'up' : 'down'; }

export const BOARDS = {
  pi4: { id: 'pi4', name: 'Raspberry Pi 4 Model B', short: 'Pi 4', w: 335, h: 220, pcb: '#1f7a3a', soc: 'BCM2711',
    rail5vLimit: 1.2, note: '5V pin budget assumes the official 3A USB-C supply (USB + GPIO share 1.2A).',
    gpioLib: 'RPi.GPIO and gpiozero both work on Pi 4.' },
  pi5: { id: 'pi5', name: 'Raspberry Pi 5', short: 'Pi 5', w: 335, h: 220, pcb: '#2a7d46', soc: 'BCM2712 + RP1',
    rail5vLimit: 1.6, note: '5V pin budget assumes the official 27W (5V 5A) supply; with a 3A supply USB+GPIO is limited to 600mA.',
    gpioLib: 'On a real Pi 5, classic RPi.GPIO does not work — install rpi-lgpio (a drop-in replacement) or use gpiozero.' },
  zero2w: { id: 'zero2w', name: 'Raspberry Pi Zero 2 W', short: 'Zero 2 W', w: 256, h: 118, pcb: '#1d6b33', soc: 'RP3A0 (BCM2710A1)',
    rail5vLimit: 1.0, note: '5V pin is fed straight from the micro-USB supply; budget assumes a 2.5A supply.',
    gpioLib: 'RPi.GPIO and gpiozero both work on Zero 2 W.' },
};
