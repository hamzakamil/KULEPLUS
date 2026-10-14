/**
 * Bağımlılıksız ZIP yazıcı — SPEC §23.2 "tam veri dışa aktarma (ZIP)".
 *
 * Yalnızca STORE yöntemi (sıkıştırmasız) kullanılır: CSV/JSON gibi metin verisinde
 * arşiv boyutu zaten küçük, hedef ise kullanıcıya tek dosya teslim etmek.
 * Ek bağımlılık (archiver/jszip) eklemek yerine ~90 satırlık deterministik üretim
 * tercih edildi; çıktı Windows/macOS/7-Zip ile açılabilir.
 *
 * Format referansı: PKWARE APPNOTE 4.5.x (local file header 0x04034b50,
 * central directory 0x02014b50, EOCD 0x06054b50).
 */

export interface ZipEntry {
  /** Arşiv içi yol — `'data/cari.csv'` gibi (ters bölü kullanılmaz). */
  name: string;
  data: Buffer | string;
}

/** ZIP'te saklanan dosya sayısı üst sınırı (16-bit alan; makul bir güvenlik tavanı). */
const MAX_ENTRIES = 65_535;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toBuffer(data: Buffer | string): Buffer {
  return typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
}

/** MS-DOS tarih/saat packed değeri (ZIP alan biçimi). */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const d =
    ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, date: d };
}

/** Girdilerden tek bir ZIP Buffer'ı üretir. */
export function buildZip(entries: ZipEntry[], modifiedAt = new Date()): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`ZIP: izin verilen giriş sayısı aşıldı (${entries.length}).`);
  }

  const { time, date } = dosDateTime(modifiedAt);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const content = toBuffer(entry.data);
    const crc = crc32(content);

    // Local file header (30 bayit sabit + isim)
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // gerekli sürüm
    local.writeUInt16LE(0, 6); // bayraklar
    local.writeUInt16LE(0, 8); // yöntem: STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18); // sıkıştırılmış boyut (STORE = ham)
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra alanı yok
    nameBuf.copy(local, 30);
    locals.push(local, content);

    // Central directory record (46 bayit sabit + isim)
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // üreten sürüm
    central.writeUInt16LE(20, 6); // gerekli sürüm
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // STORE
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // yorum
    central.writeUInt16LE(0, 34); // disk numarası
    central.writeUInt16LE(0, 36); // iç özellikler
    central.writeUInt32LE(0, 38); // dış özellikler
    central.writeUInt32LE(offset, 42); // local header ofseti
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + content.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}
