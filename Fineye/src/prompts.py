INITIAL_IMPROVMENT_PROMPTS_BY_LANGUAGE = {
    "English": """
        Transformation of Financial Comments:
        The task is to take a financial report and make it more literary and understandable for the reader.
        Make the text very professional as if it is prepared by an experienced financial/credit analyst.
        To do this, it is necessary to retain all values and meaning while making the text more pleasant to read.
        Please take into account the following:
        * The response should not contain the "_" (underscore) symbol.
        * Indicators not present in the text you provided should not be used.
        * If you encounter a 0 (zero value), describe it in words without specifying the digit.
        * The text should be grammatically correct, with the proper tense agreement (past, present, and future) in each sentence.
        * Do not use unnecessary spaces within sentences.
        * When describing DSO, DPO, DIO and CCC, use the units of measurement - days after the indicator value.
        * VERY IMPORTANT(!): GIVE THE ANSWER IN English LANGUAGE!!! 
          Give an answer without additional comments that are not related to the topic
          (so that it can be immediately inserted into the report. Here is an example of what NOT to insert:
           "Here is the refined financial analysis written in a more readable and professional format: ...");
          Don't use the expression "year" for periods, you need to use the expressions "period", "current period" and "previous period".
        
        Example:
        Text BEFORE transformation:
        
        \t \u00b7  The company did not have any gross_debt for the current period gross_debt of the Group was 4.83 B RUB
        \t \u00b7  long_term_debt of the Group showed very high growth by 62.90 % from 576.02 M RUB to 938.32 M RUB
        \t \u00b7  short_term_debt of the Group fell by 16.58 % from 4.66 B RUB to 3.89 B RUB
        \t \u00b7  equity of the Group showed growth by 19.87 % from 10.79 B RUB to 12.94 B RUB
        
        Text AFTER transformation:
        
        - As of the reporting period, the Group's total gross debt amounted to 4.83B RUB, with a noticeable shift in debt structure.
        - Long-term debt increased significantly by 62.9% to 938.32M RUB
        - Short-term debt decreased by 16.6% to 3.89B RUB.
        - The Group strengthened its financial position with equity growing by 19.9% to 12.94B RUB.
    """,
    "Russian": """
        Задача заключается в том, чтобы взять финансовый отчет и сделать его более литературным и понятным для читателя.
        Сделайте текст очень профессиональным, как если бы его подготовил опытный финансовый/кредитный аналитик.
        Для этого необходимо сохранить все значения и смысл, при этом сделать текст более приятным для чтения.
        Пожалуйста, примите во внимание следующее:
        
        Ответ не должен содержать символ "_" (подчеркивание).
        * Показатели, отсутствующие в предоставленном вами тексте, не должны быть использованы.
        * Если встречается значение 0 (ноль), опишите это словесно без указания цифры.
        * Текст должен быть грамматически правильным, с соблюдением правильного согласования времен (прошедшее, настоящее и будущее) в каждом предложении.
        * Не используйте лишние пробелы внутри предложений.
        * При описании DSO, DPO, DIO и CCC используйте единицы измерения — дни, указывая их после значения показателя.
        * ОЧЕНЬ ВАЖНО(!): ДАЙ ОТВЕТ НА РУССКОМ ЯЗЫК!
        Ответ должен быть без дополнительных комментариев, не относящихся к теме (чтобы его можно было сразу вставить в отчет). Например, не следует вставлять такие фразы, как:
        "Вот уточненный финансовый анализ, написанный в более читаемом и профессиональном формате: ...".
        Не используйте выражение "год", вместо этого используйте выражения "период", "текущий период" и "предыдущий период".
        Пример:
        Текст ДО трансформации:
        
        \t \u00b7  The company did not have any gross_debt for the current period gross_debt of the Group was 4.83 B RUB
        \t \u00b7  long_term_debt of the Group showed very high growth by 62.90 % from 576.02 M RUB to 938.32 M RUB
        \t \u00b7  short_term_debt of the Group fell by 16.58 % from 4.66 B RUB to 3.89 B RUB
        \t \u00b7  equity of the Group showed growth by 19.87 % from 10.79 B RUB to 12.94 B RUB
        
        Текст ПОСЛЕ трансформации:
        
        - На отчетную дату общий долг Группы составил 4,83 млрд руб., с заметным изменением структуры долга.
        - Долгосрочные обязательства значительно увеличились на 62,9%, составив 938,32 млн руб.
        - Краткосрочные обязательства сократились на 16,6%, составив 3,89 млрд руб.
        - Группа укрепила свою финансовое положение, увеличив собственный капитал на 19,9%, до 12,94 млрд руб.
    """,
    "Kazakh": "",
    "Uzbek": "",
    "Monglian": "",
}

IMPROVMENT_PROMPTS_BY_LANGUAGE = {
    "English": """
        LANGUAGE: English
        
        TRANSFORMATION RULES:
        1. Format:
        - No underscores
        - No extra spaces
        - No "year" references (use "period", "current period", "previous period")
        - Use "days" unit after DSO, DPO, DIO, CCC values
        
        2. Number handling:
        - For floating-point numbers, display two decimal places if the number is at least 0.01; otherwise, you can add an extra digit after the decimal point.
        - Maintain original measurements (billion/million RUB)
        
        3. Style requirements:
        - Professional financial/credit analyst tone
        - Grammatically correct with proper tense agreement
        - Clear paragraph structure
        
        4. Output format:
        - Pure transformed text
        - No meta-commentary
        - No introductory phrases
        - Each point starts with "-"
        
        INPUT TEXT TO TRANSFORM:
        {paragraph}
    """,
    "Russian": """
        ЯЗЫК: РУССКИЙ ЯЗЫК
        
        Правила трансформации:
        1. ФОРМАТ:
        - Без подчеркиваний;
        - Без лишних пробелов;
        - Без ссылок на "год" (используйте "период", "текущий период", "предыдущий период");
        - Используйте единицу "дни" после значений DSO, DPO, DIO, CCC.
        
        2. ОБРАБОТКА ЧИСЕЛ:
        - Для вещественных чисел, нужно выводить сотые доли, если число не меньше 0.01, иначе можно добавить разряд после запятой;
        - Сохраняйте оригинальные единицы измерений (миллиард/миллион руб.).
        
        3. ТРЕБОВАНИЕ К СТИЛЮ:
        - Профессиональный финансовый/кредитный аналитический тон;
        - Грамматически правильное использование времени;
        - Четкая структура абзацев.
        
        4. ФОРМАТ ВЫВОДА:
        - Только преобразованный текст;
        - Без мета-комментариев;
        - Без вводных фраз;
        - Каждый перечисляемый пункт начинается с "-".
        
        ТЕКСТ ДЛЯ ПРЕОБРАЗОВАНИЯ:
        {paragraph}
    """,
    "Kazakh": "",
    "Uzbek": "",
    "Monglian": "",
}

TRANSLATE_TRANLITERATE_PROMPTS_BY_LANGUAGE = {
    "English": """
        Instructions for translation and transliteration to ENGLISH (!!!):
            1. Translate the following content to ENGLISH (ONLY IF THE ORIGINAL TEXT IS NOT IN ENGLISH):
                - Rating comments;
                - Company status.
                
            2. Transliterate non-English items to Latin script (ONLY IF NOT ALREADY TRANSLITERATED):
                - Company names;
                - Owner names;
                - Company addresses.
                
            3. Special rules:
                - Preserve content already in ENGLISH.
                - Example: "Иванов" → "Ivanov".
    """,
    "Russian": """
        Инструкции для перевода и транслитерации на РУССКИЙ ЯЗЫК (!!!):
            1. Перевести следующее на РУССКИЙ ЯЗЫК (ТОЛЬКО ЕСЛИ ИСХОДНЫЙ ТЕКСТ НЕ НА РУССКОМ):
                - Комментарии к рейтингу;
                - Статус компании.
                
            2. Транслитерировать следующие элементы на кириллицу (ТОЛЬКО ЕСЛИ ИСХОДНЫЙ ТЕКСТ НЕ НА РУССКОМ):
                - Названия компаний;
                - Имена владельцев;
                - Адреса компаний.
                
            3. Специальные правила:
                - Сохранить контент, если он уже на РУССКОМ ЯЗЫКЕ.
                - Использовать "коэффициент ликвидности" для "liquidity ratios".
                - Пример: "Ivanov" → "Иванов".
    """,
    "Kazakh": "",
    "Uzbek": "",
    "Monglian": "",
}

TRANSLATE_TRANLITERATE_PROMPTS_BY_LANGUAGE_FOR_DESCRIPTION = {
    "English": """
        Instructions for translation to ENGLISH (!!!):
            1. Translate the following content to ENGLISH:
                - Rating comments;
                
            2. OUTPUT FORMAT:
                - Only converted text;
                - Without meta-comments;
                - Without introductory phrases;
    """,
    "Russian": """
        Инструкции для перевода на РУССКИЙ ЯЗЫК (!!!):
            1. Перевести следующее на РУССКИЙ ЯЗЫК:
                - Комментарии к рейтингу;
                
            2. ФОРМАТ ВЫВОДА:
                - Только преобразованный текст;
                - Без мета-комментариев;
                - Без вводных фраз;
    """,
    "Kazakh": "",
    "Uzbek": "",
    "Monglian": "",
}
