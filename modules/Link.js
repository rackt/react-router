import React from 'react';
import warning from 'warning';

var { bool, object, string, func } = React.PropTypes;

function isLeftClickEvent(event) {
  return event.button === 0;
}

function isModifiedEvent(event) {
  return !!(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey);
}

/**
 * A <Link> is used to create an <a> element that links to a route.
 * When that route is active, the link gets an "active" class name
 * (or the value of its `activeClassName` prop).
 *
 * For example, assuming you have the following route:
 *
 *   <Route path="/posts/:postID" component={Post} />
 *
 * You could use the following component to link to that route:
 *
 *   <Link to={`/posts/${post.id}`} />
 *
 * Links may pass along location state and/or query string parameters
 * in the state/query props, respectively.
 *
 *   <Link ... query={{ show: true }} state={{ the: 'state' }} />
 */
var Link = React.createClass({

  contextTypes: {
    history: object
  },

  propTypes: {
    activeStyle: object,
    activeClassName: string,
    onlyActiveOnIndex: bool.isRequired,
    to: string.isRequired,
    query: object,
    state: object,
    onClick: func
  },

  getDefaultProps() {
    return {
      className: '',
      activeClassName: 'active',
      onlyActiveOnIndex: false,
      style: {}
    };
  },

  getInitialState() {
    var active = this.getActiveState();
    return { active };
  },

  trySubscribe() {
    var { history } = this.context;
    if (!history) return;
    this._unlisten = history.listen(this.handleHistoryChange);
  },

  tryUnsubscribe() {
    if (!this._unlisten) return;
    this._unlisten();
    this._unlisten = undefined;
  },

  handleHistoryChange() {
    var { active } = this.state;
    var nextActive = this.getActiveState();
    if (active !== nextActive) {
      this.setState({ active: nextActive });
    }
  },

  getActiveState() {
    var { history } = this.context;
    var { to, query, onlyActiveOnIndex } = this.props;
    if (!history) return false;
    return history.isActive(to, query, onlyActiveOnIndex);
  },

  componentDidMount() {
    this.trySubscribe();
  },

  componentWillUnmount() {
    this.tryUnsubscribe();
  },

  handleClick(event) {
    var allowTransition = true;
    var clickResult;

    if (this.props.onClick)
      clickResult = this.props.onClick(event);

    if (isModifiedEvent(event) || !isLeftClickEvent(event))
      return;

    if (clickResult === false || event.defaultPrevented === true)
      allowTransition = false;

    if (this.context.router.state.location.pathname === this.props.to
        &&
        this.context.router.state.location.query == this.props.query) // == b/c query may be null / undefined
      allowTransition = false;

    event.preventDefault();

    if (allowTransition)
      this.context.history.pushState(this.props.state, this.props.to, this.props.query);
  },

  componentWillMount() {
    warning(
      this.context.history,
      'A <Link> should not be rendered outside the context of history; ' +
      'some features including real hrefs, active styling, and navigation ' +
      'will not function correctly'
    );
  },

  render() {
    var { to, query } = this.props;

    var props = {
      ...this.props,
      onClick: this.handleClick
    };

    var { history } = this.context;
    var { active } = this.state;

    // Ignore if rendered outside the context
    // of history, simplifies unit testing.
    if (history) {
      props.href = history.createHref(to, query);

      if (active) {
        if (props.activeClassName)
          props.className += props.className !== '' ? ` ${props.activeClassName}` : props.activeClassName;

        if (props.activeStyle)
          props.style = { ...props.style, ...props.activeStyle };
      }
    }

    return React.createElement('a', props);
  }

});

export default Link;
