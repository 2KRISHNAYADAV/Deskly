import React from 'react';
import './CuteRobot.css';

/**
 * Cute CSS Robot
 * Inspired by dev.to tutorial, customized for Deskly
 * Pure CSS, no JS dependencies
 */
const CuteRobot = () => {
    return (
        <div className="cute-robot">
            {/* Circle Background */}
            <div className="robot-circle">
                {/* Ears */}
                <div className="robot-ear left"></div>
                <div className="robot-ear right"></div>

                {/* Head */}
                <div className="robot-head">
                    {/* Antenna */}
                    <div className="robot-antenna"></div>

                    {/* Face */}
                    <div className="robot-face">
                        <div className="robot-eye left"></div>
                        <div className="robot-eye right"></div>
                        <div className="robot-mouth"></div>
                    </div>
                </div>

                {/* Body */}
                <div className="robot-body"></div>
            </div>
        </div>
    );
};

export default CuteRobot;

