// Six ready-to-run example projects. Each builds a project object (board, parts, wires, code).
import { PART_BY_ID } from './catalog.js';
import './geom.js';
const BBX = 0, BBY = -270;
const ROWY = { a: 45, b: 55, c: 65, d: 75, e: 85, f: 115, g: 125, h: 135, i: 145, j: 155, tp: 15, tn: 25, bn: 175, bp: 185 };
const hole = (row, col) => [BBX + 20 + (col - 1) * 10, BBY + ROWY[row]];
function mk(board) {
  const P = { v: 1, name: '', board, comps: [{ id: 'pi', part: board, x: 0, y: 0, rot: 0, ctl: {} }, { id: 'BB1', part: 'bb-half', x: BBX, y: BBY, rot: 0, ctl: {} }], wires: [], code: '' };
  let wn = 1;
  const api = {
    P,
    // place a part so that pin `pin` sits in breadboard hole (row, col)
    bb(id, part, pin, row, col, ctl = {}) { const p = PART_BY_ID[part].pins.find(q => q.n === pin); const [x, y] = hole(row, col); P.comps.push({ id, part, x: x - p.x, y: y - p.y, rot: 0, ctl }); return api; },
    at(id, part, x, y, ctl = {}, rot = 0) { P.comps.push({ id, part, x, y, rot, ctl }); return api; },
    w(a, b, color, pts = []) { P.wires.push({ id: 'w' + (wn++), a, b, color, pts }); return api; },
    // module pin -> header pin with a tidy route
    r(cid, pin, n, color, lane) { const c = P.comps.find(x => x.id === cid); const [x, y] = pinXY(c, pin); return api.w(cid + '.' + pin, 'pi.P' + n, color, route(x, y, n, lane)); },
  };
  return api;
}
const H = (row, col) => 'BB1.' + row + col;
const RED = '#ef4444', BLK = '#111827', ORG = '#f97316', GRN = '#22c55e', BLU = '#3b82f6', YEL = '#f59e0b', PUR = '#a855f7', TEAL = '#14b8a6', PNK = '#ec4899', WHT = '#e5e7eb';
// Pi header pin x positions: physical pin n -> x = 38 + floor((n-1)/2)*10, odd pins y=18, even y=8
const px = (n) => 38 + Math.floor((n - 1) / 2) * 10;
const hy = (n) => (n % 2 ? 18 : 8);
// route a module pin (world x,y; body above the pin) to Pi header pin n: down, right lane, up to the header lane, across, down
function route(x, y, n, lane) {
  const below = y + 14 + lane * 6, rx = 372 + lane * 7, top = -14 - lane * 7;
  if (y < top) return [[x, top], [px(n), top]];             // module sits above the header lanes
  return [[x, below], [rx, below], [rx, top], [px(n), top]];
}
function pinXY(comp, pin) { const p = PART_BY_ID[comp.part].pins.find(q => q.n === pin); return [comp.x + p.x, comp.y + p.y]; }
const BLINK = "# Blink: GPIO17 -> red LED -> 220 ohm resistor -> GND.\n# LED current = (3.3V - 2.0V) / (220 ohm + pin resistance) = about 5 mA.\nimport RPi.GPIO as GPIO\nimport time\n\nLED = 17                      # BCM numbering = physical pin 11\n\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(LED, GPIO.OUT)\n\ntry:\n    for i in range(20):\n        GPIO.output(LED, GPIO.HIGH)\n        print(\"blink\", i + 1, \"- on\")\n        time.sleep(0.5)\n        GPIO.output(LED, GPIO.LOW)\n        time.sleep(0.5)\n    print(\"done\")\nexcept KeyboardInterrupt:\n    print(\"stopped\")\nfinally:\n    GPIO.cleanup()            # LED off, pin back to input\n";
const BUTTON = "# Button + LED with gpiozero.\n# The button connects GPIO27 to GND. Button() enables the Pi's internal pull-up,\n# so the pin reads HIGH normally and LOW while pressed.\nfrom gpiozero import LED, Button\nfrom signal import pause\n\nled = LED(17)\nbutton = Button(27)\n\ndef pressed():\n    led.on()\n    print(\"pressed  -> LED on\")\n\ndef released():\n    led.off()\n    print(\"released -> LED off\")\n\nbutton.when_pressed = pressed\nbutton.when_released = released\n\nprint(\"Press the red button: click it on the breadboard, or hold 'Press' in the Inspector.\")\npause()\n";
const PIR = "# PIR motion alarm. The HC-SR501 runs from 5V but its OUT pin is 3.3V, so it is GPIO-safe.\nfrom gpiozero import MotionSensor, Buzzer, LED\nimport time\n\npir = MotionSensor(4)\nbuzzer = Buzzer(18)\nled = LED(17)\n\nprint(\"Armed. Select the PIR (PIR1) and press 'Walk past the sensor'.\")\ncount = 0\nwhile True:\n    pir.wait_for_motion()\n    count += 1\n    print(time.strftime(\"%H:%M:%S\"), \"motion! alarm\", count)\n    led.on()\n    buzzer.beep(0.15, 0.1, n=4, background=False)\n    pir.wait_for_no_motion()\n    led.off()\n    print(\"all quiet\")\n";
const SONAR = "# HC-SR04 -> 16x2 I2C LCD (PCF8574 backpack at address 0x27).\n# Echo is a 5V signal, so it goes through a 1k / 2k divider: 5V x 2k / 3k = 3.3V on GPIO24.\n# The LCD runs at 5V (bright text); a BSS138 level shifter keeps SDA/SCL at 3.3V on the Pi side.\n# Select US1 and move \"Distance to object\" in the Inspector.\nimport RPi.GPIO as GPIO\nimport time\nfrom RPLCD.i2c import CharLCD\n\nTRIG, ECHO = 23, 24\nGPIO.setmode(GPIO.BCM)\nGPIO.setup(TRIG, GPIO.OUT, initial=GPIO.LOW)\nGPIO.setup(ECHO, GPIO.IN)\n\nlcd = CharLCD('PCF8574', 0x27, cols=16, rows=2)\nlcd.write_string(\"Distance meter\")\ntime.sleep(1)\n\ndef measure():\n    GPIO.output(TRIG, True)\n    time.sleep(0.00001)               # 10 us trigger pulse\n    GPIO.output(TRIG, False)\n    start = end = t0 = time.time()\n    while GPIO.input(ECHO) == 0:\n        start = time.time()\n        if start - t0 > 0.1:\n            return None\n    while GPIO.input(ECHO) == 1:\n        end = time.time()\n        if end - start > 0.03:\n            return None               # no echo: nothing in range\n    return (end - start) * 34300 / 2  # 343 m/s, there and back\n\ntry:\n    while True:\n        d = measure()\n        lcd.clear()\n        if d is None:\n            lcd.write_string(\"Out of range\")\n            print(\"out of range\")\n        else:\n            lcd.write_string(\"Dist: %6.1f cm\" % d)\n            lcd.cursor_pos = (1, 0)\n            lcd.write_string(\"#\" * min(16, int(d / 10)))\n            print(\"%.1f cm\" % d)\n        time.sleep(0.5)\nexcept KeyboardInterrupt:\n    pass\nfinally:\n    lcd.clear()\n    GPIO.cleanup()\n";
const DHTOLED = "# DHT22 module on GPIO4 (it has its own pull-up) -> SSD1306 128x64 OLED at 0x3C.\n# Select DHT1 and change temperature / humidity in the Inspector.\nimport time\nimport board\nimport busio\nimport adafruit_dht\nimport adafruit_ssd1306\n\ndht = adafruit_dht.DHT22(board.D4)\ni2c = busio.I2C(board.SCL, board.SDA)\noled = adafruit_ssd1306.SSD1306_I2C(128, 64, i2c, addr=0x3C)\n\nwhile True:\n    try:\n        t = dht.temperature\n        h = dht.humidity\n    except RuntimeError as err:       # DHTs miss a reading now and then\n        print(\"read failed:\", err)\n        time.sleep(2)\n        continue\n    print(\"%.1f C   %.1f %%RH\" % (t, h))\n    oled.fill(0)\n    oled.text(\"Pi Lab weather\", 0, 0, 1)\n    oled.hline(0, 11, 128, 1)\n    oled.text(\"Temp: %5.1f C\" % t, 0, 20, 1)\n    oled.text(\"Hum:  %5.1f %%\" % h, 0, 34, 1)\n    oled.rect(0, 50, 124, 10, 1)\n    oled.fill_rect(2, 52, int(h / 100 * 120), 6, 1)\n    oled.show()\n    time.sleep(2)\n";
const SERVO = "# Servo follows a potentiometer.\n# 10k pot (GND / wiper / 3.3V) -> MCP3008 CH0 on SPI0 CE0 -> SG90 servo on GPIO18.\n# Select RV1 and drag \"Knob position\" in the Inspector.\nfrom gpiozero import MCP3008, AngularServo\nimport time\n\npot = MCP3008(channel=0)                  # 0.0 .. 1.0\nservo = AngularServo(18, min_angle=-90, max_angle=90,\n                     min_pulse_width=0.0005, max_pulse_width=0.0024)\n\nlast = None\nwhile True:\n    angle = round(pot.value * 180 - 90)\n    if angle != last:\n        servo.angle = angle\n        print(\"pot %.2f V  ->  servo %+d deg\" % (pot.voltage, angle))\n        last = angle\n    time.sleep(0.05)\n";
export const EXAMPLES = [
  { id: 'blink', name: 'Blink an LED', desc: 'GPIO17 → red LED → 220Ω → GND, with RPi.GPIO.', build() {
    const e = mk('pi4'); e.P.name = 'Blink';
    e.bb('D1', 'led-5-red-d', 'A', 'e', 12).bb('R1', 'res-cf14-220', '1', 'b', 13)
      .w('pi.P11', H('j', 12), GRN, [[px(11), -40], [130, -40]]).w(H('a', 17), H('tn', 17), BLK).w('pi.P6', H('bn', 2), BLK, [[px(6), -30], [30, -30]])
      .w(H('tn', 1), H('bn', 1), BLK, [[10, -245], [3, -245], [3, -95], [10, -95]]).w(H('d', 12), H('g', 12), GRN);
    e.P.code = BLINK; return e.P; } },
  { id: 'button', name: 'Button + LED', desc: 'Press the button on GPIO27 to light the LED on GPIO17 (gpiozero, internal pull-up).', build() {
    const e = mk('pi4'); e.P.name = 'Button + LED';
    e.bb('D1', 'led-5-green-d', 'A', 'e', 12).bb('R1', 'res-cf14-330', '1', 'b', 13).bb('SW1', 'btn-12x12-red', '1', 'e', 22)
      .w('pi.P11', H('j', 12), GRN, [[px(11), -40], [130, -40]]).w(H('d', 12), H('g', 12), GRN).w(H('a', 17), H('tn', 17), BLK)
      .w('pi.P13', H('j', 22), YEL, [[px(13), -30], [230, -30]]).w(H('a', 24), H('tn', 23), BLK)
      .w('pi.P6', H('bn', 2), BLK, [[px(6), -50], [30, -50]]).w(H('tn', 1), H('bn', 1), BLK, [[10, -245], [3, -245], [3, -95], [10, -95]]);
    e.P.code = BUTTON; return e.P; } },
  { id: 'pir', name: 'PIR motion alarm', desc: 'HC-SR501 on GPIO4 sounds an active buzzer on GPIO18 and lights an LED on GPIO17.', build() {
    const e = mk('pi4'); e.P.name = 'PIR alarm';
    e.at('PIR1', 'pir-hcsr501', 420, -110).at('BZ1', 'buz-ky012', 430, 150);
    e.bb('D1', 'led-5-red-d', 'A', 'e', 12).bb('R1', 'res-cf14-220', '1', 'b', 13)
      .w('pi.P11', H('j', 12), GRN, [[px(11), -40], [130, -40]]).w(H('d', 12), H('g', 12), GRN).w(H('a', 17), H('tn', 17), BLK)
      .w('pi.P6', H('bn', 2), BLK, [[px(6), -50], [30, -50]]).w(H('tn', 1), H('bn', 1), BLK, [[10, -245], [3, -245], [3, -95], [10, -95]])
      .r('PIR1', 'VCC', 2, RED, 0).r('PIR1', 'OUT', 7, YEL, 1).r('PIR1', 'GND', 9, BLK, 2)
      .r('BZ1', 'S', 12, BLU, 3).r('BZ1', 'VCC', 4, RED, 4).r('BZ1', 'GND', 14, BLK, 5);
    e.P.code = PIR; return e.P; } },
  { id: 'sonar-lcd', name: 'HC-SR04 distance → LCD', desc: 'Ultrasonic sensor (Echo through a 1k/2k divider) and a 5V 16×2 I2C LCD behind a level shifter.', build() {
    const e = mk('pi4'); e.P.name = 'Distance to LCD';
    e.at('US1', 'us-hcsr04', 470, -110, { dist: 42 }).at('LCD1', 'lcd1602-i2c-27-b', 470, 170).at('LS1', 'ls-bss138', 470, 330);
    e.bb('R1', 'res-cf14-1000', '1', 'c', 8).bb('R2', 'res-cf14-2000', '1', 'h', 12)
      .r('US1', 'VCC', 2, RED, 0).r('US1', 'Trig', 16, YEL, 1).w('US1.GND', H('tn', 26), BLK, [[500, -60], [345, -60], [345, -245]])
      .w('US1.Echo', H('a', 8), PUR, [[490, -50], [355, -50], [355, -285], [90, -285]])
      .w(H('e', 12), H('f', 12), PUR).w(H('j', 16), H('bn', 16), BLK).w('pi.P18', H('j', 12), TEAL, [[px(18), -40], [130, -40]])
      .w('pi.P6', H('bn', 2), BLK, [[px(6), -50], [30, -50]]).w(H('tn', 1), H('bn', 1), BLK, [[10, -245], [3, -245], [3, -95], [10, -95]])
      .r('LCD1', 'GND', 14, BLK, 2).r('LCD1', 'VCC', 4, RED, 3)
      .r('LS1', 'LV1', 3, BLU, 4).r('LS1', 'LV2', 5, GRN, 5).r('LS1', 'LV', 17, ORG, 6).r('LS1', 'GND', 20, BLK, 7)
      .w('LCD1.SDA', 'LS1.HV1', BLU, [[490, 192], [700, 192], [700, 350], [530, 350]])
      .w('LCD1.SCL', 'LS1.HV2', GRN, [[500, 198], [708, 198], [708, 356], [540, 356]])
      .w('LS1.HV', 'LCD1.VCC', RED, [[550, 362], [716, 362], [716, 186], [480, 186]]);
    e.P.code = SONAR; return e.P; } },
  { id: 'dht-oled', name: 'DHT22 → OLED', desc: 'Temperature and humidity from a DHT22 module on GPIO4, drawn on a 128×64 SSD1306 OLED.', build() {
    const e = mk('pi4'); e.P.name = 'DHT22 to OLED'; e.P.comps = e.P.comps.filter(c => c.id !== 'BB1');
    e.at('DHT1', 'dht22-mod', 440, -90, { temp: 26.4, hum: 61 }).at('OLED1', 'oled-096-w', 480, 260);
    e.r('DHT1', 'VCC', 1, ORG, 0).r('DHT1', 'DATA', 7, YEL, 1).r('DHT1', 'GND', 9, BLK, 2)
      .r('OLED1', 'GND', 6, BLK, 2).r('OLED1', 'VCC', 17, ORG, 3).r('OLED1', 'SCL', 5, GRN, 4).r('OLED1', 'SDA', 3, BLU, 5);
    e.P.code = DHTOLED; return e.P; } },
  { id: 'servo-pot', name: 'Servo + potentiometer', desc: 'A 10k pot read by an MCP3008 ADC over SPI steers an SG90 servo on GPIO18.', build() {
    const e = mk('pi4'); e.P.name = 'Servo + pot';
    e.bb('U1', 'adc-mcp3008', 'DGND', 'e', 4).bb('RV1', 'pot-wh148-b10000', '1', 'b', 20, { pos: 0.5 }).at('M1', 'srv-sg90', 470, 120);
    e.w(H('tp', 2), 'pi.P1', ORG, [[20, -60], [px(1), -60]]).w(H('tn', 3), 'pi.P6', BLK, [[30, -50], [px(6), -50]])
      .w(H('a', 11), H('tp', 11), ORG).w(H('a', 10), H('tp', 10), ORG).w(H('a', 9), H('tn', 9), BLK).w(H('a', 4), H('tn', 4), BLK)
      .w(H('j', 4), H('a', 22), GRN, [[50, -100], [220, -100], [220, -230]])
      .w('pi.P23', H('b', 8), TEAL, [[px(23), -40], [355, -40], [355, -215], [80 + 10, -215]])
      .w('pi.P21', H('c', 7), PUR, [[px(21), -30], [362, -30], [362, -205], [80, -205]])
      .w('pi.P19', H('d', 6), BLU, [[px(19), -20], [369, -20], [369, -195], [70, -195]])
      .w('pi.P24', H('d', 5), YEL, [[px(24), -10], [376, -10], [376, -188], [60, -188]])
      .w(H('a', 20), H('tn', 20), BLK).w(H('a', 24), H('tp', 25), ORG)
      .r('M1', 'GND', 20, BLK, 0).r('M1', 'V+', 2, RED, 1).r('M1', 'SIG', 12, YEL, 2);
    e.P.code = SERVO; return e.P; } },
];
