// evelyn_bot_rx.ino - Receives Evelyn's 8-byte checksummed packets at 115200 baud
const int PIN_L_PWM = 5, PIN_L_DIR = 4, PIN_R_PWM = 6, PIN_R_DIR = 7;
unsigned long lastRxMs = 0;
uint8_t buf[8];

void stopMotors() { analogWrite(PIN_L_PWM, 0); analogWrite(PIN_R_PWM, 0); }

void setMotor(int pwmPin, int dirPin, int8_t val) {
  digitalWrite(dirPin, val >= 0 ? HIGH : LOW);
  int mag = val < 0 ? -val : val;
  if (mag > 100) mag = 100;
  analogWrite(pwmPin, (mag * 255) / 100);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_L_PWM, OUTPUT); pinMode(PIN_L_DIR, OUTPUT);
  pinMode(PIN_R_PWM, OUTPUT); pinMode(PIN_R_DIR, OUTPUT);
  stopMotors();
}

void loop() {
  if (millis() - lastRxMs > 500) stopMotors(); // Hardware dead-man watchdog
  if (Serial.available() >= 8) {
    if (Serial.peek() != 0xAA) { Serial.read(); return; }
    Serial.readBytes(buf, 8);
    uint8_t x = 0; for (int i = 0; i < 7; i++) x ^= buf[i];
    if (x != buf[7]) return; // Drop corrupted packet
    lastRxMs = millis();
    if (buf[1] == 0) { stopMotors(); return; }
    if (buf[1] == 1) {
      setMotor(PIN_L_PWM, PIN_L_DIR, (int8_t)buf[2]);
      setMotor(PIN_R_PWM, PIN_R_DIR, (int8_t)buf[3]);
    }
  }
}
