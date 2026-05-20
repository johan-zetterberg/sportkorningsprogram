import re

def fix_marathon():
    with open('js/pages/maraton-resultat.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Add CSS
    css_to_add = """
      /* STICKY COLUMNS */
      .sticky-col-start { position: sticky; left: 0; z-index: 3; min-width: 38px; width: 38px; text-align:center; }
      .sticky-col-driver { position: sticky; left: 38px; z-index: 3; min-width: 130px; max-width: 170px; }
      @media (min-width: 1024px) {
         .sticky-col-start { left: 0; min-width: 48px; width: 48px; }
         .sticky-col-driver { left: 48px; min-width: 180px; max-width: 220px; }
      }
      .pr-table tbody td {"""
    
    if "/* STICKY COLUMNS */" not in content:
        content = content.replace("      .pr-table tbody td {", css_to_add)

    # 2. Add classes to TH
    content = content.replace(
        "${thSort(`${thClass} w-12`, 'startNumber', t('startno'))}",
        "${thSort(`${thClass} w-12 sticky-col-start bg-gray-50 dark:bg-gray-700`, 'startNumber', t('startno'))}"
    )
    content = content.replace(
        "${thSort(thClass, 'driverName', t('driver'))}",
        "${thSort(`${thClass} sticky-col-driver bg-gray-50 dark:bg-gray-700`, 'driverName', t('driver'))}"
    )

    # 3. Add classes to TD in renderRow
    content = content.replace(
        """<td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm text-center text-gray-900 dark:text-white">${sn}</td>""",
        """<td class="px-2 py-1.5 lg:px-3 lg:py-2.5 text-[11px] lg:text-sm text-center text-gray-900 dark:text-white sticky-col-start ${rowBgClass}">${sn}</td>"""
    )
    content = content.replace(
        """<td class="px-2 py-1.5 lg:px-3 lg:py-2.5">""",
        """<td class="px-2 py-1.5 lg:px-3 lg:py-2.5 sticky-col-driver ${rowBgClass}">"""
    )

    with open('js/pages/maraton-resultat.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed maraton-resultat.js")

fix_marathon()
