import openai

from .prompts import (
    INITIAL_IMPROVMENT_PROMPTS_BY_LANGUAGE,
    IMPROVMENT_PROMPTS_BY_LANGUAGE,
)


class CommentImprover:
    def __init__(
        self,
        dict_with_data: dict,
        target_company_registration_identifier: str,
        language: str,
        token: str
    ):
        self.dict_with_data = dict_with_data
        self.token = token
        self.target_company_registration_identifier = target_company_registration_identifier
        self.language = language
    
    @staticmethod
    def __improve_paragraph(paragraph: str, token: str, language: str) -> str:
        """
        Метод обрабатывающий параграф финансовых комментариев с помощью GPT
        
        :param paragraph: str | необработанный параграф
        :return: str | обработанный параграф
        """
        
        openai.api_key = token
        initial_prompt = INITIAL_IMPROVMENT_PROMPTS_BY_LANGUAGE[language]
        
        prompt = IMPROVMENT_PROMPTS_BY_LANGUAGE[language].format(paragraph=paragraph)
        
        response = openai.chat.completions.create(
            model="gpt-4o",  # Укажите чат-модель, которую вы хотите использовать
            messages=[
                {"role": "system", "content": initial_prompt},
                {"role": "user", "content": prompt}
            ]
        )
        
        improved_paragraph = response.choices[0].message.content.replace("\n\n\n", "\n\n")
        
        return improved_paragraph
    
    def get_improve_comments(self) -> dict:
        """
        Метод исправляющий комментарии в отчетах за последние два доступных года
        
        :return: dict | отчеты компаний с исправленными финансовыми комментариями
        """
        
        data = self.dict_with_data["data"]
        period = list(sorted(list(data[self.target_company_registration_identifier])))[-1]
        target_company_report = data[self.target_company_registration_identifier][period]
        
        conclusion_comments_paragraph = target_company_report.get("conclusion_paragraph", None)
        balance_comments_paragraph = target_company_report.get("balance_comments_paragraph", None)
        income_comments_paragraph = target_company_report.get("income_comments_paragraph", None)
        ratio_comments_paragraph = target_company_report.get("ratio_comments_paragraph", None)
        
        target_company_report["improved_conclusion_comments_paragraph"] = None
        target_company_report["improved_balance_comments_paragraph"] = None
        target_company_report["improved_income_comments_paragraph"] = None
        target_company_report["improved_ratio_comments_paragraph"] = None
        
        if conclusion_comments_paragraph:
            if not conclusion_comments_paragraph[0]:
                conclusion_comments_paragraph = [["Для вывода заключения недостаточно информации"]]
            try:
                improved_conclusion_comments_paragraph = CommentImprover.__improve_paragraph(
                    "\n\n".join(income_comments_paragraph[0]).replace("_", " "),
                    token=self.token, language=self.language,)
                print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | conclusion paragraph")
            except:  # noqa: E722
                try:
                    improved_conclusion_comments_paragraph = CommentImprover.__improve_paragraph(
                    "\n\n".join(income_comments_paragraph[0]).replace("_", " "),
                    token=self.token, language=self.language,)
                    print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | conclusion paragraph")
                except:  # noqa: E722
                    try:
                        improved_conclusion_comments_paragraph = CommentImprover.__improve_paragraph(
                            "\n\n".join(income_comments_paragraph[0]).replace("_", " "),
                            token=self.token, language=self.language,)
                        print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | conclusion paragraph")
                    except Exception as ex:
                        print(f"при попытке улучшить комментарии о conclusion произошла ошибка - {ex}")
                        improved_conclusion_comments_paragraph =  None
            target_company_report[
                "improved_conclusion_comments_paragraph"] = improved_conclusion_comments_paragraph
        
        if balance_comments_paragraph:
            if not balance_comments_paragraph[0]:
                balance_comments_paragraph = [["Для расчёта баланса недостаточно информации"]]
            try:
                improved_balance_comments_paragraph = CommentImprover.__improve_paragraph(
                    "\n\n".join(balance_comments_paragraph[0]).replace("_", " "),
                    token=self.token, language=self.language,)
                print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | balance paragraph")
            except:  # noqa: E722
                try:
                    improved_balance_comments_paragraph = CommentImprover.__improve_paragraph(
                        "\n\n".join(balance_comments_paragraph[0]).replace("_", " "),
                        token=self.token, language=self.language,)
                    print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | balance paragraph")
                except:  # noqa: E722
                    try:
                        improved_balance_comments_paragraph = CommentImprover.__improve_paragraph(
                            "\n\n".join(balance_comments_paragraph[0]).replace("_", " "),
                            token=self.token, language=self.language,)
                        print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | balance paragraph")
                        # time.sleep(15)
                    except Exception as ex:
                        print(f"при попытке улучшить комментарии о balance произошла ошибка - {ex}")
                        improved_balance_comments_paragraph = None
            target_company_report["improved_balance_comments_paragraph"] = improved_balance_comments_paragraph
        
        if income_comments_paragraph:
            if not income_comments_paragraph[0]:
                income_comments_paragraph = [["Для расчёта прибыли/убытков информации недостаточно"]]
            try:
                improved_income_comments_paragraph = CommentImprover.__improve_paragraph(
                    "\n\n".join(income_comments_paragraph[0]).replace("_", " "),
                    token=self.token, language=self.language,)
                print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | income paragraph")
            except:  # noqa: E722
                try:
                    improved_income_comments_paragraph = CommentImprover.__improve_paragraph(
                        "\n\n".join(income_comments_paragraph[0]).replace("_", " "),
                        token=self.token, language=self.language,)
                    print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | income paragraph")
                except:  # noqa: E722
                    try:
                        improved_income_comments_paragraph = CommentImprover.__improve_paragraph(
                            "\n\n".join(income_comments_paragraph[0]).replace("_", " "),
                            token=self.token, language=self.language,)
                        print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | income paragraph")
                    except Exception as ex:
                        print(f"при попытке улучшить комментарии о income произошла ошибка - {ex}")
                        improved_income_comments_paragraph = None
            target_company_report["improved_income_comments_paragraph"] = improved_income_comments_paragraph
        
        if ratio_comments_paragraph:
            if not ratio_comments_paragraph[0]:
                ratio_comments_paragraph = [["Для расчёта финансовых коэффициентов информации недостаточно"]]
            try:
                improved_ratio_comments_paragraph = CommentImprover.__improve_paragraph(
                    "\n\n".join(ratio_comments_paragraph[0]).replace("_", " "),
                    token=self.token, language=self.language,)
                print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | ratios paragraph")
            except:  # noqa: E722
                try:
                    improved_ratio_comments_paragraph = CommentImprover.__improve_paragraph(
                        "\n\n".join(ratio_comments_paragraph[0]).replace("_", " "),
                        token=self.token, language=self.language,)
                    print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | ratios paragraph")
                except:  # noqa: E722
                    try:
                        improved_ratio_comments_paragraph = CommentImprover.__improve_paragraph(
                            "\n\n".join(ratio_comments_paragraph[0]).replace("_", " "),
                            token=self.token, language=self.language,)
                        print(f"OGRN: {self.target_company_registration_identifier} | year: {period} | ratios paragraph")
                    except Exception as ex:
                        print(f"при попытке улучшить комментарии о ratio произошла ошибка - {ex}")
                        improved_ratio_comments_paragraph = None
            
            target_company_report["improved_ratio_comments_paragraph"] = improved_ratio_comments_paragraph
        
        return self.dict_with_data
