from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import json, time, pathlib, re

INSPECT_URL = "https://novelai.net/inspect"
uuid_pat = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
    r"[0-9a-f]{4}-[0-9a-f]{12}\.png$",
    re.I,
)


def get_meta_from_inspect(png_path: pathlib.Path) -> dict | None:
    opts = Options()
    opts.add_argument("--headless=new")
    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()), options=opts
    )

    try:
        driver.get(INSPECT_URL)
        time.sleep(2)  # ページが完全にロードされるのを待つ

        # ページのHTMLをデバッグ用に取得
        print(f"Page title: {driver.title}")

        # ファイル選択要素を探す - より一般的な方法
        file_inputs = driver.find_elements(By.CSS_SELECTOR, "input[type='file']")
        if file_inputs:
            file_inputs[0].send_keys(str(png_path.resolve()))
            print(f"File uploaded: {png_path.name}")
        else:
            # ファイル選択ダイアログを開くボタンを探す
            upload_buttons = driver.find_elements(
                By.XPATH,
                "//button[contains(text(), 'Upload') or contains(text(), 'ファイル') or contains(text(), 'アップロード')]",
            )
            if upload_buttons:
                upload_buttons[0].click()
                time.sleep(1)

                # 再度ファイル入力要素を探す
                file_inputs = driver.find_elements(
                    By.CSS_SELECTOR, "input[type='file']"
                )
                if file_inputs:
                    file_inputs[0].send_keys(str(png_path.resolve()))
                    print(f"File uploaded after clicking button: {png_path.name}")
                else:
                    print("No file input found after clicking upload button")
                    return None
            else:
                print("No upload button found")
                # JavaScriptでファイル選択を試みる
                driver.execute_script("""
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.style.display = 'none';
                    document.body.appendChild(input);
                    input.click();
                """)
                time.sleep(1)

                # 作成したinput要素を探す
                file_inputs = driver.find_elements(
                    By.CSS_SELECTOR, "input[type='file']"
                )
                if file_inputs:
                    file_inputs[0].send_keys(str(png_path.resolve()))
                    print(f"File uploaded via JS: {png_path.name}")
                else:
                    print("Could not create file input via JS")
                    return None

        # JSONデータが表示されるのを待つ
        for _ in range(50):  # 5 秒待機
            try:
                # 様々なセレクタを試す
                for selector in [
                    "pre",
                    "code",
                    ".json",
                    "[data-json]",
                    "div.json",
                    "div > pre",
                    "div > code",
                ]:
                    elements = driver.find_elements(By.CSS_SELECTOR, selector)
                    for element in elements:
                        txt = element.get_attribute("textContent")
                        if txt and txt.strip().startswith("{"):
                            try:
                                data = json.loads(txt)
                                if data:  # 空でなければ
                                    return data
                            except json.JSONDecodeError:
                                continue
            except Exception as e:
                print(f"Waiting for data: {e}")
            time.sleep(0.1)

        # 最後の手段: ページ内のすべてのテキストコンテンツを検索
        page_source = driver.page_source
        # 中括弧で囲まれたJSONを探す正規表現
        json_pattern = re.compile(r'({[^{]*"prompt":[^}]*})')
        matches = json_pattern.findall(page_source)
        for match in matches:
            try:
                data = json.loads(match)
                if "prompt" in data:
                    return data
            except json.JSONDecodeError:
                continue

    except Exception as e:
        print(f"Error in inspect: {e}")
    finally:
        driver.quit()

    return None


# --- 単体テスト ---
if __name__ == "__main__":
    # 指定された画像パスを使用
    test_file = pathlib.Path(
        "/Users/hikarimac/Documents/python/ImageToPrompts/images/4c58ff9b-a435-44b2-a452-aaf68d4d1566.png"
    )

    if not test_file.exists():
        print(f"指定された画像ファイルが見つかりません: {test_file}")
        sys.exit(1)

    print(f"テスト用ファイル: {test_file}")

    meta = get_meta_from_inspect(test_file)
    if meta:
        print(json.dumps(meta, indent=2, ensure_ascii=False))
    else:
        print("メタデータを取得できませんでした")
