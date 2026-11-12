"""AAB 안의 네이티브 라이브러리(.so)가 16KB 메모리 페이지에 맞게 정렬됐는지 확인한다 (Play 요구 사항)."""
import struct, sys, zipfile

def load_aligns(data):
    if data[:4] != b'\x7fELF' or data[4] != 2:  # 64비트 ELF만
        return None
    phoff = struct.unpack_from('<Q', data, 0x20)[0]
    phentsize, phnum = struct.unpack_from('<HH', data, 0x36)
    out = []
    for i in range(phnum):
        off = phoff + i * phentsize
        p_type = struct.unpack_from('<I', data, off)[0]
        if p_type == 1:  # PT_LOAD
            out.append(struct.unpack_from('<Q', data, off + 0x30)[0])
    return out

bad = []
n = 0
with zipfile.ZipFile(sys.argv[1]) as z:
    for name in z.namelist():
        if not name.endswith('.so') or ('/arm64-v8a/' not in name and '/x86_64/' not in name):
            continue
        al = load_aligns(z.read(name))
        if al is None:
            continue
        n += 1
        ok = all(a >= 16384 for a in al)
        print(('OK  ' if ok else 'FAIL'), name, [hex(a) for a in al])
        if not ok:
            bad.append(name)
print(f'\n확인한 라이브러리 {n}개, 16KB 미만 정렬 {len(bad)}개')
if bad:
    print('::warning::16KB 정렬이 안 된 라이브러리가 있습니다. Play 업로드 시 경고/거부될 수 있습니다:')
    for b in bad: print(' -', b)
    sys.exit(1)
