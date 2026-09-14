$ErrorActionPreference = 'Stop'

$path = "Source\Games\Unreal Engine\main.cpp"
$text = Get-Content -Path $path -Raw

$helper = @'

   static float* bl3_screen_percentage_data = nullptr;
   static bool bl3_screen_percentage_search_done = false;
   static bool bl3_screen_percentage_logged = false;

   static float* BL3FindScreenPercentageData()
   {
      auto* base = reinterpret_cast<uint8_t*>(GetModuleHandleW(nullptr));
      if (base == nullptr)
         return nullptr;

      auto* dos = reinterpret_cast<IMAGE_DOS_HEADER*>(base);
      if (dos->e_magic != IMAGE_DOS_SIGNATURE)
         return nullptr;
      auto* nt = reinterpret_cast<IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
      if (nt->Signature != IMAGE_NT_SIGNATURE)
         return nullptr;

      constexpr wchar_t needle[] = L"r.ScreenPercentage";
      constexpr size_t needle_bytes = sizeof(needle) - sizeof(wchar_t);
      uint8_t* name_address = nullptr;
      auto* sections = IMAGE_FIRST_SECTION(nt);

      for (WORD s = 0; s < nt->FileHeader.NumberOfSections && name_address == nullptr; ++s)
      {
         const auto& section = sections[s];
         if ((section.Characteristics & IMAGE_SCN_MEM_READ) == 0)
            continue;
         const size_t section_size = static_cast<size_t>(section.Misc.VirtualSize);
         if (section_size < needle_bytes)
            continue;
         uint8_t* section_base = base + section.VirtualAddress;
         for (size_t i = 0; i + needle_bytes <= section_size; ++i)
         {
            if (std::memcmp(section_base + i, needle, needle_bytes) == 0)
            {
               name_address = section_base + i;
               break;
            }
         }
      }

      if (name_address == nullptr)
         return nullptr;

      for (WORD s = 0; s < nt->FileHeader.NumberOfSections; ++s)
      {
         const auto& section = sections[s];
         if ((section.Characteristics & IMAGE_SCN_MEM_EXECUTE) == 0)
            continue;

         uint8_t* section_base = base + section.VirtualAddress;
         const size_t section_size = static_cast<size_t>(section.Misc.VirtualSize);
         if (section_size < 7)
            continue;

         for (size_t i = 0; i + 7 <= section_size; ++i)
         {
            uint8_t* instruction = section_base + i;
            // lea rdx, [rip+disp32] -> console variable name
            if (instruction[0] != 0x48 || instruction[1] != 0x8D || instruction[2] != 0x15)
               continue;

            int32_t name_disp = 0;
            std::memcpy(&name_disp, instruction + 3, sizeof(name_disp));
            uint8_t* referenced = instruction + 7 + name_disp;
            if (referenced != name_address)
               continue;

            const size_t back = i > 160 ? i - 160 : 0;
            for (size_t j = i; j-- > back; )
            {
               uint8_t* candidate_instruction = section_base + j;
               // lea rcx, [rip+disp32] -> global TAutoConsoleVariable<float> object
               if (candidate_instruction[0] != 0x48 || candidate_instruction[1] != 0x8D || candidate_instruction[2] != 0x0D)
                  continue;

               int32_t object_disp = 0;
               std::memcpy(&object_disp, candidate_instruction + 3, sizeof(object_disp));
               uint8_t* object_address = candidate_instruction + 7 + object_disp;

               if (!BL3MemoryWritable(object_address, 0x18))
                  continue;

               auto** ref_slot = reinterpret_cast<float**>(object_address + 0x10);
               if (!BL3MemoryWritable(ref_slot, sizeof(*ref_slot)))
                  continue;

               float* ref = *ref_slot;
               if (ref == nullptr || !BL3MemoryWritable(ref, sizeof(float) * 2))
                  continue;

               const bool plausible_game = std::isfinite(ref[0]) && ref[0] >= -1.0f && ref[0] <= 200.0f;
               const bool plausible_render = std::isfinite(ref[1]) && ref[1] >= -1.0f && ref[1] <= 200.0f;
               if (plausible_game && plausible_render)
               {
                  reshade::log::message(reshade::log::level::info, "[Luma] BL3: Found r.ScreenPercentage runtime data; auto-forcing 85 percent.");
                  return ref;
               }
            }
         }
      }

      return nullptr;
   }

   static void BL3ForceScreenPercentage85()
   {
      if (!bl3_screen_percentage_search_done)
      {
         bl3_screen_percentage_data = BL3FindScreenPercentageData();
         bl3_screen_percentage_search_done = true;
         if (bl3_screen_percentage_data == nullptr)
            reshade::log::message(reshade::log::level::warning, "[Luma] BL3: Could not locate r.ScreenPercentage runtime data.");
      }

      if (bl3_screen_percentage_data != nullptr && BL3MemoryWritable(bl3_screen_percentage_data, sizeof(float) * 2))
      {
         bl3_screen_percentage_data[0] = 85.0f;
         bl3_screen_percentage_data[1] = 85.0f;
         if (!bl3_screen_percentage_logged)
         {
            bl3_screen_percentage_logged = true;
            reshade::log::message(reshade::log::level::info, "[Luma] BL3: Automatic ScreenPercentage=85 is active.");
         }
      }
   }
'@

$namespaceEndPattern = '\}\s*// namespace\s*\r?\n\s*\r?\nstruct GameDeviceDataUnrealEngine'
$namespaceEndReplacement = $helper + "`r`n} // namespace`r`n`r`nstruct GameDeviceDataUnrealEngine"
$patched = [regex]::Replace($text, $namespaceEndPattern, $namespaceEndReplacement, 1)
if ($patched -eq $text) { throw "Could not insert BL3 ScreenPercentage helper." }
$text = $patched

$presentPattern = 'BL3ForceTemporalUpsampling\(\);'
$presentReplacement = "BL3ForceTemporalUpsampling();`r`n      BL3ForceScreenPercentage85();"
$patched = [regex]::Replace($text, $presentPattern, $presentReplacement, 1)
if ($patched -eq $text) { throw "Could not hook BL3 ScreenPercentage=85 into OnPresent." }
$text = $patched

Set-Content -Path $path -Value $text -Encoding utf8 -NoNewline
Write-Host "Added automatic r.ScreenPercentage=85 forcing."
Select-String -Path $path -Pattern "BL3ForceScreenPercentage85|ScreenPercentage runtime|85.0f" -Context 1,3
