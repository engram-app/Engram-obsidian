//! The thin wasm32 ABI over the pure core: fixed windows in linear memory,
//! numbers in and out. Everything Engram-specific lives in `lib.rs`; this file
//! is the only part that would not move to a rustler NIF.

use crate::{BUF_LEN, OUT_LEN, base64_encode, fnv1a_base64};

static mut BUF: [u8; BUF_LEN] = [0; BUF_LEN];
static mut OUT: [u8; OUT_LEN] = [0; OUT_LEN];

fn input(len: usize) -> &'static [u8] {
    // SAFETY: single-threaded wasm; JS writes the window only between
    // calls, so nothing aliases this shared borrow while it lives.
    unsafe { core::slice::from_raw_parts((&raw const BUF).cast(), len.min(BUF_LEN)) }
}

/// Address of the input window inside linear memory.
#[unsafe(no_mangle)]
pub extern "C" fn buf_ptr() -> *mut u8 {
    (&raw mut BUF).cast()
}

/// Continue hash `h` over the first `len` bytes of the window
/// (clamped to the window, so a bad `len` cannot read out of bounds).
#[unsafe(no_mangle)]
pub extern "C" fn fnv1a_b64(h: u32, len: usize) -> u32 {
    fnv1a_base64(h, input(len))
}

/// Address of the base64 output window.
#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    (&raw const OUT).cast()
}

/// Base64 of the first `len` window bytes into the output window;
/// returns the output length.
#[unsafe(no_mangle)]
pub extern "C" fn b64_encode(len: usize) -> usize {
    // SAFETY: as in `input`; OUT is only ever borrowed here.
    let out = unsafe { core::slice::from_raw_parts_mut((&raw mut OUT).cast(), OUT_LEN) };
    base64_encode(input(len), out)
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
