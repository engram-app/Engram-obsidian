//! Engram's pure-Rust core: byte-exact logic every client must agree on.
//!
//! Plain functions over slices, no I/O, no allocation, no wasm types; the
//! wasm32 ABI lives in `wasm_abi.rs`, so the same code can back a rustler NIF
//! (backend) or a different wasm host (web app) unchanged. `no_std` on wasm32
//! only, to keep the module ~1 KB.
#![cfg_attr(target_arch = "wasm32", no_std)]

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PAD: u8 = b'=';
const PRIME: u32 = 0x0100_0193;
/// FNV-1a 32-bit offset basis: the state to start a fresh hash from.
pub const FNV_OFFSET: u32 = 0x811c_9dc5;

#[inline(always)]
fn mix(h: u32, c: u8) -> u32 {
    (h ^ c as u32).wrapping_mul(PRIME)
}

/// FNV-1a 32-bit over the padded standard base64 of `bytes`, without building
/// the base64. Resumable: feed the previous return value back as `h`, as long
/// as every chunk except the last has a length divisible by 3.
pub fn fnv1a_base64(mut h: u32, bytes: &[u8]) -> u32 {
    let mut triples = bytes.chunks_exact(3);
    for t in &mut triples {
        let v = (t[0] as u32) << 16 | (t[1] as u32) << 8 | t[2] as u32;
        h = mix(h, B64[(v >> 18) as usize]);
        h = mix(h, B64[(v >> 12 & 63) as usize]);
        h = mix(h, B64[(v >> 6 & 63) as usize]);
        h = mix(h, B64[(v & 63) as usize]);
    }
    match *triples.remainder() {
        [a] => {
            let v = (a as u32) << 16;
            h = mix(h, B64[(v >> 18) as usize]);
            h = mix(h, B64[(v >> 12 & 63) as usize]);
            h = mix(mix(h, PAD), PAD);
        }
        [a, b] => {
            let v = (a as u32) << 16 | (b as u32) << 8;
            h = mix(h, B64[(v >> 18) as usize]);
            h = mix(h, B64[(v >> 12 & 63) as usize]);
            h = mix(mix(h, B64[(v >> 6 & 63) as usize]), PAD);
        }
        _ => {}
    }
    h
}

/// Standard padded base64 of `bytes` into `out`; returns the bytes written.
/// `out` must hold `bytes.len().div_ceil(3) * 4`; a short `out` truncates.
pub fn base64_encode(bytes: &[u8], out: &mut [u8]) -> usize {
    let mut n = 0;
    let mut triples = bytes.chunks_exact(3);
    for (t, o) in (&mut triples).zip(out.chunks_exact_mut(4)) {
        let v = (t[0] as u32) << 16 | (t[1] as u32) << 8 | t[2] as u32;
        o.copy_from_slice(&quad(v));
        n += 4;
    }
    let tail = match *triples.remainder() {
        [a] => {
            let [w, x, _, _] = quad((a as u32) << 16);
            Some([w, x, PAD, PAD])
        }
        [a, b] => {
            let [w, x, y, _] = quad((a as u32) << 16 | (b as u32) << 8);
            Some([w, x, y, PAD])
        }
        _ => None,
    };
    if let (Some(q), Some(o)) = (tail, out.get_mut(n..n + 4)) {
        o.copy_from_slice(&q);
        n += 4;
    }
    n
}

#[inline(always)]
fn quad(v: u32) -> [u8; 4] {
    [
        B64[(v >> 18) as usize],
        B64[(v >> 12 & 63) as usize],
        B64[(v >> 6 & 63) as usize],
        B64[(v & 63) as usize],
    ]
}

/// Size of the shared input window. A multiple of 3 so chunked hashing can
/// resume mid-stream (see [`fnv1a_base64`]) and base64 chunks concatenate
/// without inner padding.
pub const BUF_LEN: usize = 3 * 16 * 1024;
/// Output window: the base64 of a full input window.
pub const OUT_LEN: usize = BUF_LEN / 3 * 4;

#[cfg(target_arch = "wasm32")]
mod wasm_abi;

#[cfg(test)]
mod tests {
    use super::*;

    fn b64(bytes: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        for c in bytes.chunks(3) {
            let v = (c[0] as u32) << 16
                | (*c.get(1).unwrap_or(&0) as u32) << 8
                | *c.get(2).unwrap_or(&0) as u32;
            out.push(B64[(v >> 18) as usize]);
            out.push(B64[(v >> 12 & 63) as usize]);
            out.push(if c.len() > 1 {
                B64[(v >> 6 & 63) as usize]
            } else {
                PAD
            });
            out.push(if c.len() > 2 {
                B64[(v & 63) as usize]
            } else {
                PAD
            });
        }
        out
    }

    fn fnv(s: &[u8]) -> u32 {
        s.iter().fold(FNV_OFFSET, |h, &c| mix(h, c))
    }

    fn pseudo_random(n: usize) -> Vec<u8> {
        let mut x = 0x9e37_79b9_u32;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                x as u8
            })
            .collect()
    }

    #[test]
    fn empty_is_offset_basis() {
        assert_eq!(fnv1a_base64(FNV_OFFSET, &[]), FNV_OFFSET);
    }

    #[test]
    fn known_vector_matches_ts() {
        // fnv1a("aGVsbG8=") as computed by src/content-hash.ts.
        assert_eq!(fnv1a_base64(FNV_OFFSET, b"hello"), fnv(b"aGVsbG8="));
    }

    #[test]
    fn matches_reference_for_padding_lengths_and_all_bytes() {
        let all: Vec<u8> = (0..=255).collect();
        for n in 0..=9 {
            let data = &all[..n];
            assert_eq!(fnv1a_base64(FNV_OFFSET, data), fnv(&b64(data)), "len {n}");
        }
        assert_eq!(fnv1a_base64(FNV_OFFSET, &all), fnv(&b64(&all)));
    }

    #[test]
    fn encode_matches_reference() {
        let all: Vec<u8> = (0..=255).collect();
        let mut out = vec![0; OUT_LEN];
        for n in (0..=9).chain([255, 256]) {
            let w = base64_encode(&all[..n], &mut out);
            assert_eq!(&out[..w], b64(&all[..n]).as_slice(), "len {n}");
        }
        assert_eq!(base64_encode(b"hello", &mut out), 8);
        assert_eq!(&out[..8], b"aGVsbG8=");
    }

    #[test]
    fn chunked_equals_one_shot() {
        let data = pseudo_random(BUF_LEN * 3 + 2);
        let chunked = data.chunks(BUF_LEN).fold(FNV_OFFSET, fnv1a_base64);
        assert_eq!(chunked, fnv1a_base64(FNV_OFFSET, &data));
        assert_eq!(chunked, fnv(&b64(&data)));
    }
}
