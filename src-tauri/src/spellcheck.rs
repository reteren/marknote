use std::sync::OnceLock;

use crate::settings::UI_LANGUAGES;

static AVAILABLE_LANGUAGES: OnceLock<Vec<String>> = OnceLock::new();

/// Коды языков MarkNote, для которых Windows сообщает об установленном словаре.
/// Результат COM-запроса кэшируется до завершения процесса.
pub fn available_language_codes() -> Vec<String> {
    cached_languages(&AVAILABLE_LANGUAGES, query_available_languages)
}

fn cached_languages(
    cache: &OnceLock<Vec<String>>,
    query: impl FnOnce() -> Vec<String>,
) -> Vec<String> {
    cache.get_or_init(query).clone()
}

fn query_available_languages() -> Vec<String> {
    #[cfg(windows)]
    let tags = match windows_com::supported_language_tags() {
        Ok(tags) => tags,
        Err(reason) => {
            eprintln!("Windows spell-check language query failed: {reason}");
            return Vec::new();
        }
    };

    #[cfg(not(windows))]
    let tags: Vec<String> = {
        eprintln!("Windows spell-check dictionaries are unavailable on this platform.");
        Vec::new()
    };

    if tags.is_empty() {
        eprintln!("Windows Spell Checking API returned no supported language tags.");
        return Vec::new();
    }

    eprintln!("Windows Spell Checking API language tags: {tags:?}");
    let codes = map_language_tags(&tags);
    if codes.is_empty() {
        eprintln!("No Windows spell-check dictionaries match MarkNote's supported languages.");
    }
    codes
}

fn map_language_tags(tags: &[String]) -> Vec<String> {
    let mut available = Vec::new();
    for tag in tags {
        let primary = tag
            .trim()
            .split(['-', '_'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if UI_LANGUAGES.contains(&primary.as_str()) && !available.contains(&primary) {
            available.push(primary);
        }
    }

    // Стабильный порядок совпадает с таблицей языков в настройках.
    UI_LANGUAGES
        .iter()
        .filter(|code| available.iter().any(|found| found == **code))
        .map(|code| (*code).to_owned())
        .collect()
}

#[cfg(windows)]
mod windows_com {
    use std::{ffi::c_void, ptr};

    use windows_sys::{
        core::{GUID, HRESULT},
        Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_MULTITHREADED,
        },
    };

    const CLSID_SPELL_CHECKER_FACTORY: GUID = GUID {
        data1: 0x7ab3_6653,
        data2: 0x1796,
        data3: 0x484b,
        data4: [0xbd, 0xfa, 0xe7, 0x4f, 0x1d, 0xb7, 0xc1, 0xdc],
    };
    const IID_SPELL_CHECKER_FACTORY: GUID = GUID {
        data1: 0x8e01_8a9d,
        data2: 0x2415,
        data3: 0x4677,
        data4: [0xbf, 0x08, 0x79, 0x4e, 0xa6, 0x1f, 0x94, 0xbb],
    };
    const RPC_E_CHANGED_MODE: HRESULT = 0x8001_0106u32 as i32;
    const S_FALSE: HRESULT = 1;
    const MAX_LANGUAGE_TAG_UNITS: usize = 256;

    type QueryInterfaceFn =
        unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> HRESULT;
    type AddRefFn = unsafe extern "system" fn(*mut c_void) -> u32;
    type ReleaseFn = unsafe extern "system" fn(*mut c_void) -> u32;

    #[repr(C)]
    struct IUnknownVTable {
        query_interface: QueryInterfaceFn,
        add_ref: AddRefFn,
        release: ReleaseFn,
    }

    #[repr(C)]
    struct SpellCheckerFactoryVTable {
        query_interface: QueryInterfaceFn,
        add_ref: AddRefFn,
        release: ReleaseFn,
        get_supported_languages:
            unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
        _is_supported: unsafe extern "system" fn(*mut c_void, *const u16, *mut i32) -> HRESULT,
        _create_spell_checker:
            unsafe extern "system" fn(*mut c_void, *const u16, *mut *mut c_void) -> HRESULT,
    }

    #[repr(C)]
    struct EnumStringVTable {
        query_interface: QueryInterfaceFn,
        add_ref: AddRefFn,
        release: ReleaseFn,
        next: unsafe extern "system" fn(*mut c_void, u32, *mut *mut u16, *mut u32) -> HRESULT,
        _skip: unsafe extern "system" fn(*mut c_void, u32) -> HRESULT,
        _reset: unsafe extern "system" fn(*mut c_void) -> HRESULT,
        _clone: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    }

    struct ComApartment {
        uninitialize_on_drop: bool,
    }

    impl ComApartment {
        fn initialize() -> Result<Self, String> {
            // CoInitializeEx returns S_FALSE when this thread already has the requested apartment;
            // both S_OK and S_FALSE require a matching CoUninitialize call.
            let result = unsafe { CoInitializeEx(ptr::null(), COINIT_MULTITHREADED as u32) };
            if result >= 0 {
                return Ok(Self {
                    uninitialize_on_drop: true,
                });
            }

            // The host may have initialized this thread as an STA. COM is still initialized and
            // usable there, but this call did not acquire an initialization count to release.
            if result == RPC_E_CHANGED_MODE {
                eprintln!(
                    "COM is already initialized in another apartment; using the host apartment."
                );
                return Ok(Self {
                    uninitialize_on_drop: false,
                });
            }

            Err(format!(
                "CoInitializeEx returned HRESULT 0x{:08X}",
                result as u32
            ))
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            if self.uninitialize_on_drop {
                unsafe { CoUninitialize() };
            }
        }
    }

    struct ComPtr(*mut c_void);

    impl ComPtr {
        fn new(pointer: *mut c_void) -> Option<Self> {
            (!pointer.is_null()).then_some(Self(pointer))
        }

        fn as_raw(&self) -> *mut c_void {
            self.0
        }
    }

    impl Drop for ComPtr {
        fn drop(&mut self) {
            if self.0.is_null() {
                return;
            }
            unsafe {
                let vtable = *(self.0 as *mut *const IUnknownVTable);
                ((*vtable).release)(self.0);
            }
        }
    }

    struct CoTaskString(*mut u16);

    impl Drop for CoTaskString {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // IEnumString::Next returns allocated LPOLESTR values, released with CoTaskMemFree.
                unsafe { CoTaskMemFree(self.0.cast::<c_void>()) };
            }
        }
    }

    pub(super) fn supported_language_tags() -> Result<Vec<String>, String> {
        let _apartment = ComApartment::initialize()?;
        let mut factory_raw = ptr::null_mut();
        let result = unsafe {
            CoCreateInstance(
                &CLSID_SPELL_CHECKER_FACTORY,
                ptr::null_mut(),
                CLSCTX_INPROC_SERVER,
                &IID_SPELL_CHECKER_FACTORY,
                &mut factory_raw,
            )
        };
        let Some(factory) = ComPtr::new(factory_raw) else {
            return Err(format!(
                "CoCreateInstance returned HRESULT 0x{:08X} and a null interface",
                result as u32
            ));
        };
        if result < 0 {
            return Err(format!(
                "CoCreateInstance failed with HRESULT 0x{:08X}",
                result as u32
            ));
        }

        let factory_vtable =
            unsafe { *(factory.as_raw() as *mut *const SpellCheckerFactoryVTable) };
        let mut enumerator_raw = ptr::null_mut();
        let result = unsafe {
            ((*factory_vtable).get_supported_languages)(factory.as_raw(), &mut enumerator_raw)
        };
        let Some(enumerator) = ComPtr::new(enumerator_raw) else {
            return Err(format!(
                "get_SupportedLanguages returned HRESULT 0x{:08X} and a null enumerator",
                result as u32
            ));
        };
        if result < 0 {
            return Err(format!(
                "get_SupportedLanguages failed with HRESULT 0x{:08X}",
                result as u32
            ));
        }

        let enumerator_vtable = unsafe { *(enumerator.as_raw() as *mut *const EnumStringVTable) };
        let mut tags = Vec::new();
        loop {
            let mut wide_tag = ptr::null_mut();
            let mut fetched = 0u32;
            let result = unsafe {
                ((*enumerator_vtable).next)(enumerator.as_raw(), 1, &mut wide_tag, &mut fetched)
            };
            let task_string = CoTaskString(wide_tag);

            if result < 0 {
                return Err(format!(
                    "IEnumString::Next failed with HRESULT 0x{:08X}",
                    result as u32
                ));
            }
            if fetched == 0 {
                if result == S_FALSE {
                    break;
                }
                return Err("IEnumString::Next succeeded without returning an item".to_owned());
            }
            if fetched != 1 || task_string.0.is_null() {
                return Err(
                    "IEnumString::Next returned an invalid item count or null string".to_owned(),
                );
            }

            tags.push(read_wide_string(task_string.0)?);
            drop(task_string);
        }

        Ok(tags)
    }

    fn read_wide_string(value: *const u16) -> Result<String, String> {
        if value.is_null() {
            return Err("IEnumString returned a null language tag".to_owned());
        }
        let mut length = 0;
        while length < MAX_LANGUAGE_TAG_UNITS {
            if unsafe { *value.add(length) } == 0 {
                let slice = unsafe { std::slice::from_raw_parts(value, length) };
                return Ok(String::from_utf16_lossy(slice));
            }
            length += 1;
        }
        Err("IEnumString returned an unterminated language tag".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn region_tags_map_to_supported_base_codes_and_deduplicate() {
        let tags = [
            "ru-RU".to_owned(),
            "en-US".to_owned(),
            "en-GB".to_owned(),
            "PT-br".to_owned(),
            "zh-Hans-CN".to_owned(),
            "xx-YY".to_owned(),
        ];

        assert_eq!(map_language_tags(&tags), ["en", "ru", "pt", "zh"]);
    }

    #[test]
    fn empty_dictionary_list_is_safe_for_callers() {
        let no_languages: Vec<String> = Vec::new();
        assert!(map_language_tags(&no_languages).is_empty());
    }

    #[test]
    fn repeated_calls_use_the_cached_result_without_requerying() {
        let cache = OnceLock::new();
        let calls = Cell::new(0);

        let first = cached_languages(&cache, || {
            calls.set(calls.get() + 1);
            Vec::new()
        });
        let second = cached_languages(&cache, || {
            calls.set(calls.get() + 1);
            vec!["en".to_owned()]
        });

        assert!(first.is_empty());
        assert!(second.is_empty());
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn windows_query_returns_a_safe_cached_list() {
        let languages = available_language_codes();
        println!("Spell-check languages available on this machine: {languages:?}");
        assert!(languages
            .iter()
            .all(|language| UI_LANGUAGES.contains(&language.as_str())));
    }
}
