import { Component } from 'react'
import { downloadBackup } from '../store'

// 화면 한 곳이 잘못돼도 앱 전체가 하얘지지 않게 하는 안전장치 (2026-08-11).
// 2026-08-11에 루틴 목록이 무한 렌더에 빠지면서 로그인 화면조차 못 그리고 하얗게 남은 적이 있다.
// 그때 사용자가 볼 수 있는 게 아무것도 없었던 게 문제 — 최소한 "무엇이 잘못됐고 어떻게 빠져나가는지"는 보여야 한다.
//
// 두 겹으로 쓴다:
//  · main.jsx — 앱 전체를 감싼다. 여기까지 오면 앱이 통째로 못 뜬 것이라 백업 받기를 같이 준다.
//  · App.jsx — 화면(메모·루틴·보관함…)마다 감싼다. 한 화면이 죽어도 왼쪽 메뉴로 다른 화면에 갈 수 있다.
// ⚠️ 리액트의 이 장치는 '그리는 중'의 오류만 잡는다. 버튼을 눌렀을 때 나는 오류는 못 잡는다.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err, info) {
    console.error('화면 오류', err, info)
  }

  render() {
    const { err } = this.state
    if (!err) return this.props.children
    const whole = this.props.whole
    return (
      <div className="eb">
        <div className="eb-title">{whole ? '앱을 여는 중 문제가 생겼습니다' : '이 화면에 문제가 생겼습니다'}</div>
        <div className="eb-msg">
          {whole ? (
            <>
              기록은 그대로 있습니다 — 이 기기와 서버에 저장된 내용은 이 문제로 사라지지 않습니다.
              <br />
              새로고침으로 대개 풀립니다. 계속 이러면 아래 내용을 개발자에게 보여주세요.
            </>
          ) : (
            <>
              다른 화면은 정상입니다 — 왼쪽 메뉴로 옮겨 계속 쓰셔도 됩니다.
              <br />
              아래 내용을 개발자에게 보여주시면 원인을 찾을 수 있습니다.
            </>
          )}
        </div>
        <pre className="eb-err">{String((err && err.stack) || err).slice(0, 600)}</pre>
        <div className="eb-btns">
          <button className="btn-done" onClick={() => this.setState({ err: null })}>
            다시 시도
          </button>
          <button onClick={() => window.location.reload()}>새로고침</button>
          {whole && (
            <button title="이 기기에 저장된 기록을 파일로 내려받습니다" onClick={downloadBackup}>
              백업 받기
            </button>
          )}
        </div>
      </div>
    )
  }
}
